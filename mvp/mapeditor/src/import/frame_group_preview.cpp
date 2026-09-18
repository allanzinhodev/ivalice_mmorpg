#include "frame_group_preview.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <stdexcept>

#include "png_image.hpp"

namespace mvp::mapeditor::import
{

namespace
{

void blitIndexed(std::vector<uint8_t>& canvas, int canvasWidth, int canvasHeight, int destX, int destY, int srcWidth,
                  int srcHeight, const uint8_t* indexed, const std::array<shared::dat::PaletteEntry, 256>& palette,
                  uint8_t colorKeyIndex)
{
	for (int y = 0; y < srcHeight; ++y) {
		const int canvasY = destY + y;
		if (canvasY < 0 || canvasY >= canvasHeight) {
			continue;
		}
		for (int x = 0; x < srcWidth; ++x) {
			const int canvasX = destX + x;
			if (canvasX < 0 || canvasX >= canvasWidth) {
				continue;
			}
			const uint8_t colorIndex = indexed[y * srcWidth + x];
			if (colorIndex == colorKeyIndex) {
				continue;
			}
			const shared::dat::PaletteEntry& entry = palette[colorIndex];
			const size_t dstOffset = (static_cast<size_t>(canvasY) * canvasWidth + canvasX) * 4;
			canvas[dstOffset + 0] = entry.r;
			canvas[dstOffset + 1] = entry.g;
			canvas[dstOffset + 2] = entry.b;
			canvas[dstOffset + 3] = 255;
		}
	}
}

void blitCell(std::vector<uint8_t>& canvas, int canvasWidth, int canvasHeight, const Point& topLeft,
               const MapCellPieces& cell, const std::vector<uint8_t>& tilePixels,
               const std::array<shared::dat::PaletteEntry, 256>& palette, uint8_t colorKeyIndex)
{
	for (int pieceRow = 0; pieceRow < PIECE_ROWS_PER_CELL; ++pieceRow) {
		for (int pieceCol = 0; pieceCol < PIECE_COLS_PER_CELL; ++pieceCol) {
			const uint16_t pieceIndex = cell.pieceIds[pieceRow][pieceCol];
			if (pieceIndex == EMPTY_TILE_INDEX) {
				continue;
			}
			const uint8_t* indexed = &tilePixels[static_cast<size_t>(pieceIndex) * PIECE_SIZE * PIECE_SIZE];
			const int destX = topLeft.x + pieceCol * PIECE_SIZE;
			const int destY = topLeft.y + pieceRow * PIECE_SIZE;
			blitIndexed(canvas, canvasWidth, canvasHeight, destX, destY, PIECE_SIZE, PIECE_SIZE, indexed, palette,
			            colorKeyIndex);
		}
	}
}

} // namespace

void writeTilesetPreview(const TilesetImportResult& result, const std::array<shared::dat::PaletteEntry, 256>& palette,
                          uint8_t colorKeyIndex, const std::string& outputPngPath)
{
	if (result.terrainGrid.empty()) {
		throw std::runtime_error("writeTilesetPreview: grade vazia");
	}

	// Canvas do MESMO tamanho da imagem original (não do bounding box das
	// projeções, que é maior -- a calibração de origem existe justamente
	// para encaixar o desenho dentro dos limites reais da imagem, igual ao
	// script de referência: Image.blank(ref.width, ref.height)).
	const int canvasWidth = result.sourceImageWidth;
	const int canvasHeight = result.sourceImageHeight;

	std::vector<uint8_t> canvas(static_cast<size_t>(canvasWidth) * canvasHeight * 4, 0);

	for (int row = 0; row < result.heightCells; ++row) {
		for (int col = 0; col < result.widthCells; ++col) {
			const uint8_t elevation = result.terrainGrid[row][col].elevation;
			const Point topLeft = projectCellTopLeft(col, row, elevation, result.origin);
			blitCell(canvas, canvasWidth, canvasHeight, topLeft, result.terrainGrid[row][col], result.tilePixels,
			         palette, colorKeyIndex);
			blitCell(canvas, canvasWidth, canvasHeight, topLeft, result.overlayGrid[row][col], result.tilePixels,
			         palette, colorKeyIndex);
		}
	}

	writePng(outputPngPath, canvasWidth, canvasHeight, canvas);

	const double dedupPercent = result.rawPieceCount == 0
	                                ? 0.0
	                                : 100.0 * (1.0 - static_cast<double>(result.tiles.size()) /
	                                                      static_cast<double>(result.rawPieceCount));
	std::printf("writeTilesetPreview: %zu pecas unicas de %zu brutas (dedup %.1f%%), preview em %s\n",
	            result.tiles.size(), result.rawPieceCount, dedupPercent, outputPngPath.c_str());
}

void writeOutfitPreview(const OutfitImportResult& result, const std::array<shared::dat::PaletteEntry, 256>& palette,
                         uint8_t colorKeyIndex, const std::string& outputPngPath)
{
	if (result.creatures.empty()) {
		throw std::runtime_error("writeOutfitPreview: nenhuma outfit importada");
	}

	// Mosaico: 1 miniatura por outfit (frame group 0, fase 0, Sul, seco),
	// 32x48 cada, em grade quadrada -- o suficiente para uma inspeção visual
	// rápida de "as cores/silhuetas saíram certas" antes de gravar.
	constexpr int FRAME_W = 32;
	constexpr int FRAME_H = 48;

	const int columns = static_cast<int>(std::ceil(std::sqrt(static_cast<double>(result.creatures.size()))));
	const int rows = (static_cast<int>(result.creatures.size()) + columns - 1) / columns;
	const int canvasWidth = columns * FRAME_W;
	const int canvasHeight = rows * FRAME_H;

	std::vector<uint8_t> canvas(static_cast<size_t>(canvasWidth) * canvasHeight * 4, 0);

	for (size_t i = 0; i < result.creatures.size(); ++i) {
		const auto& creature = result.creatures[i];
		if (creature.frameGroups.empty() || creature.frameGroups[0].phases.empty()) {
			continue;
		}
		const uint16_t frameIndex = creature.frameGroups[0].phases[0].spriteIndexDrySouth;
		const uint8_t* indexed = &result.framePixels[static_cast<size_t>(frameIndex) * FRAME_W * FRAME_H];

		const int cellCol = static_cast<int>(i) % columns;
		const int cellRow = static_cast<int>(i) / columns;
		blitIndexed(canvas, canvasWidth, canvasHeight, cellCol * FRAME_W, cellRow * FRAME_H, FRAME_W, FRAME_H, indexed,
		            palette, colorKeyIndex);
	}

	writePng(outputPngPath, canvasWidth, canvasHeight, canvas);
	std::printf("writeOutfitPreview: %zu outfits, mosaico em %s\n", result.creatures.size(), outputPngPath.c_str());
}

} // namespace mvp::mapeditor::import
