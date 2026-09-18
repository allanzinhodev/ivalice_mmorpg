#include "tile_dedup.hpp"

#include <algorithm>
#include <map>
#include <stdexcept>

#include "height_map.hpp"
#include "png_image.hpp"

namespace mvp::mapeditor::import
{

using shared::dat::PaletteEntry;
using shared::dat::TileLayer;
using shared::dat::TileRecord;

Point projectCellTopLeft(int col, int row, int height, const Point& origin)
{
	return Point{origin.x + (col - row) * TILE_HALF_W, origin.y + (col + row) * TILE_HALF_H - height * PX_PER_HEIGHT};
}

namespace
{

uint32_t fnv1a(const uint8_t* data, size_t size)
{
	uint32_t hash = 0x811c9dc5u;
	for (size_t i = 0; i < size; ++i) {
		hash ^= data[i];
		hash *= 0x01000193u;
	}
	return hash;
}

// Altura "confiável" para calibração: a mediana do mapa. Alguns mapas do
// FFTA têm 1-2 células com altura muito acima do resto (ex.: 31 num mapa
// que varia 2-7) -- são dados reais da ROM, não erro de extração, mas se
// entrarem no cálculo do extremo da grade (min/max ingênuo) deslocam a
// origem inteira, porque uma única célula alta "sobe" mais que qualquer
// outra e vira o novo relMinY. A mediana ignora esse tipo de outlier sem
// precisar de um limiar arbitrário.
uint8_t medianHeight(const HeightMap& heightMap)
{
	std::vector<uint8_t> heights;
	heights.reserve(static_cast<size_t>(heightMap.width) * heightMap.height);
	for (const auto& row : heightMap.grid) {
		heights.insert(heights.end(), row.begin(), row.end());
	}
	std::sort(heights.begin(), heights.end());
	return heights[heights.size() / 2];
}

// calibrate() -- mesma fórmula validada em
// tools/asset-compiler/extract-map-tiles.js (comentários ali explicam a
// escolha de cada constante: PX_PER_HEIGHT medido, SPRITE_H estabilizado em
// 48, calibração pelo bounding box do conteúdo em vez de força bruta), com
// um ajuste: usa a altura mediana no lugar da altura real de cada célula
// para achar o extremo relMinY, evitando que outliers de altura desloquem a
// origem de todo o mapa (ver medianHeight acima).
Point calibrate(const PngImage& reference, const HeightMap& heightMap)
{
	int contentMinX = reference.width;
	int contentMinY = reference.height;
	for (int y = 0; y < reference.height; ++y) {
		for (int x = 0; x < reference.width; ++x) {
			const size_t offset = (static_cast<size_t>(y) * reference.width + x) * 4;
			if (reference.pixels[offset + 3] != 0) {
				contentMinX = std::min(contentMinX, x);
				contentMinY = std::min(contentMinY, y);
			}
		}
	}

	const uint8_t referenceHeight = medianHeight(heightMap);

	int relMinX = INT32_MAX;
	int relMinY = INT32_MAX;
	for (int row = 0; row < heightMap.height; ++row) {
		for (int col = 0; col < heightMap.width; ++col) {
			const int x = (col - row) * TILE_HALF_W;
			const int y = (col + row) * TILE_HALF_H - referenceHeight * PX_PER_HEIGHT;
			relMinX = std::min(relMinX, x);
			relMinY = std::min(relMinY, y);
		}
	}

	return Point{contentMinX - relMinX, contentMinY - relMinY};
}

// Recorta o bloco CELL_W x CELL_H da imagem fonte na posição projetada da
// célula (col,row,height). Fora dos limites da imagem = transparente (borda
// do mapa).
void cutCellBlock(const PngImage& image, const Point& topLeft, uint8_t* outRgba)
{
	for (int y = 0; y < CELL_H; ++y) {
		for (int x = 0; x < CELL_W; ++x) {
			const int srcX = topLeft.x + x;
			const int srcY = topLeft.y + y;
			const size_t dstOffset = (static_cast<size_t>(y) * CELL_W + x) * 4;
			if (srcX < 0 || srcY < 0 || srcX >= image.width || srcY >= image.height) {
				outRgba[dstOffset + 0] = 0;
				outRgba[dstOffset + 1] = 0;
				outRgba[dstOffset + 2] = 0;
				outRgba[dstOffset + 3] = 0;
				continue;
			}
			const size_t srcOffset = (static_cast<size_t>(srcY) * image.width + srcX) * 4;
			outRgba[dstOffset + 0] = image.pixels[srcOffset + 0];
			outRgba[dstOffset + 1] = image.pixels[srcOffset + 1];
			outRgba[dstOffset + 2] = image.pixels[srcOffset + 2];
			outRgba[dstOffset + 3] = image.pixels[srcOffset + 3];
		}
	}
}

bool isPieceFullyTransparent(const uint8_t* blockRgba, int pieceCol, int pieceRow)
{
	for (int y = 0; y < PIECE_SIZE; ++y) {
		for (int x = 0; x < PIECE_SIZE; ++x) {
			const int blockX = pieceCol * PIECE_SIZE + x;
			const int blockY = pieceRow * PIECE_SIZE + y;
			const size_t offset = (static_cast<size_t>(blockY) * CELL_W + blockX) * 4;
			if (blockRgba[offset + 3] != 0) {
				return false;
			}
		}
	}
	return true;
}

// Paleta global compartilhada: uma entrada por cor RGB distinta (índice 0
// reservado para o colorkey/transparência). Sem quantização de perda no M1
// -- ver nota em dat-spr-v1.md sobre o risco de estourar 255 cores quando
// outfits entrarem (M2).
class PaletteBuilder
{
public:
	uint8_t colorKeyIndex() const { return 0; }

	uint8_t indexFor(uint8_t r, uint8_t g, uint8_t b, bool transparent)
	{
		if (transparent) {
			return colorKeyIndex();
		}
		const uint32_t key = (static_cast<uint32_t>(r) << 16) | (static_cast<uint32_t>(g) << 8) | b;
		auto it = colorToIndex.find(key);
		if (it != colorToIndex.end()) {
			return it->second;
		}
		if (entries.size() >= 255) {
			throw std::runtime_error("PaletteBuilder: mais de 255 cores distintas -- quantização não implementada");
		}
		const uint8_t index = static_cast<uint8_t>(entries.size() + 1);
		colorToIndex.emplace(key, index);
		entries.push_back(PaletteEntry{r, g, b});
		return index;
	}

	std::array<PaletteEntry, 256> build() const
	{
		std::array<PaletteEntry, 256> palette{};
		palette[0] = PaletteEntry{255, 0, 255};
		for (size_t i = 0; i < entries.size(); ++i) {
			palette[i + 1] = entries[i];
		}
		return palette;
	}

private:
	std::map<uint32_t, uint8_t> colorToIndex;
	std::vector<PaletteEntry> entries;
};

class Deduplicator
{
public:
	explicit Deduplicator(std::vector<TileRecord>& tiles, std::vector<uint8_t>& tilePixels)
	    : tiles(tiles), tilePixels(tilePixels)
	{}

	uint16_t insert(TileLayer layer, const uint8_t indexedPixels[PIECE_SIZE * PIECE_SIZE])
	{
		const uint32_t hash = fnv1a(indexedPixels, PIECE_SIZE * PIECE_SIZE);
		auto range = byHash.equal_range(hash);
		for (auto it = range.first; it != range.second; ++it) {
			const uint16_t candidate = it->second;
			const uint8_t* existing = &tilePixels[static_cast<size_t>(candidate) * PIECE_SIZE * PIECE_SIZE];
			if (std::equal(existing, existing + PIECE_SIZE * PIECE_SIZE, indexedPixels)) {
				return candidate;
			}
		}

		const uint16_t newIndex = static_cast<uint16_t>(tiles.size());
		TileRecord record;
		record.layer = layer;
		record.contentHash = hash;
		record.spriteIndex = newIndex;
		tiles.push_back(record);
		tilePixels.insert(tilePixels.end(), indexedPixels, indexedPixels + PIECE_SIZE * PIECE_SIZE);
		byHash.emplace(hash, newIndex);
		return newIndex;
	}

private:
	std::vector<TileRecord>& tiles;
	std::vector<uint8_t>& tilePixels;
	std::unordered_multimap<uint32_t, uint16_t> byHash;
};

MapCellPieces processCellBlock(const PngImage& image, TileLayer layer, const Point& topLeft,
                                 PaletteBuilder& paletteBuilder, Deduplicator& dedup, size_t& rawPieceCounter)
{
	uint8_t block[CELL_W * CELL_H * 4];
	cutCellBlock(image, topLeft, block);

	MapCellPieces cell{};
	for (int pieceRow = 0; pieceRow < PIECE_ROWS_PER_CELL; ++pieceRow) {
		for (int pieceCol = 0; pieceCol < PIECE_COLS_PER_CELL; ++pieceCol) {
			++rawPieceCounter;
			if (isPieceFullyTransparent(block, pieceCol, pieceRow)) {
				cell.pieceIds[pieceRow][pieceCol] = EMPTY_TILE_INDEX;
				continue;
			}

			uint8_t indexed[PIECE_SIZE * PIECE_SIZE];
			for (int y = 0; y < PIECE_SIZE; ++y) {
				for (int x = 0; x < PIECE_SIZE; ++x) {
					const int blockX = pieceCol * PIECE_SIZE + x;
					const int blockY = pieceRow * PIECE_SIZE + y;
					const size_t offset = (static_cast<size_t>(blockY) * CELL_W + blockX) * 4;
					const uint8_t r = block[offset + 0];
					const uint8_t g = block[offset + 1];
					const uint8_t b = block[offset + 2];
					const uint8_t a = block[offset + 3];
					indexed[y * PIECE_SIZE + x] = paletteBuilder.indexFor(r, g, b, a == 0);
				}
			}
			cell.pieceIds[pieceRow][pieceCol] = dedup.insert(layer, indexed);
		}
	}
	return cell;
}

} // namespace

TilesetImportResult importAizenfieldTileset(const std::string& terrainPngPath, const std::string& overlayPngPath,
                                             const std::string& heightMapJsonPath, int mapIndex)
{
	const PngImage terrain = loadPng(terrainPngPath);
	const PngImage overlay = loadPng(overlayPngPath);
	const HeightMap heightMap = loadHeightMap(heightMapJsonPath, mapIndex);

	if (terrain.width != overlay.width || terrain.height != overlay.height) {
		throw std::runtime_error("importAizenfieldTileset: terrain e overlay têm dimensões diferentes");
	}

	TilesetImportResult result;
	result.widthCells = static_cast<uint16_t>(heightMap.width);
	result.heightCells = static_cast<uint16_t>(heightMap.height);
	result.origin = calibrate(terrain, heightMap);
	result.sourceImageWidth = terrain.width;
	result.sourceImageHeight = terrain.height;
	result.rawPieceCount = 0;

	PaletteBuilder paletteBuilder;
	Deduplicator dedup(result.tiles, result.tilePixels);

	result.terrainGrid.assign(heightMap.height, std::vector<MapCellPieces>(heightMap.width));
	result.overlayGrid.assign(heightMap.height, std::vector<MapCellPieces>(heightMap.width));

	for (int row = 0; row < heightMap.height; ++row) {
		for (int col = 0; col < heightMap.width; ++col) {
			const uint8_t height = heightMap.grid[row][col];
			const Point topLeft = projectCellTopLeft(col, row, height, result.origin);

			MapCellPieces terrainCell =
			    processCellBlock(terrain, TileLayer::Terrain, topLeft, paletteBuilder, dedup, result.rawPieceCount);
			MapCellPieces overlayCell =
			    processCellBlock(overlay, TileLayer::Overlay, topLeft, paletteBuilder, dedup, result.rawPieceCount);

			terrainCell.elevation = static_cast<uint8_t>(height - heightMap.minHeight);
			overlayCell.elevation = terrainCell.elevation;

			result.terrainGrid[row][col] = terrainCell;
			result.overlayGrid[row][col] = overlayCell;
		}
	}

	result.palette = paletteBuilder.build();
	result.colorKeyIndex = paletteBuilder.colorKeyIndex();

	return result;
}

} // namespace mvp::mapeditor::import
