#include "frame_group_preview.hpp"

#include <algorithm>
#include <cstdio>
#include <stdexcept>

#include "png_image.hpp"

namespace mvp::mapeditor::import
{

namespace
{

void blitPiece(std::vector<uint8_t>& canvas, int canvasWidth, int canvasHeight, int destX, int destY,
                const std::vector<uint8_t>& tilePixels, const std::array<shared::dat::PaletteEntry, 256>& palette,
                uint8_t colorKeyIndex, uint16_t pieceIndex)
{
	if (pieceIndex == EMPTY_TILE_INDEX) {
		return;
	}
	const uint8_t* indexed = &tilePixels[static_cast<size_t>(pieceIndex) * PIECE_SIZE * PIECE_SIZE];
	for (int y = 0; y < PIECE_SIZE; ++y) {
		const int canvasY = destY + y;
		if (canvasY < 0 || canvasY >= canvasHeight) {
			continue;
		}
		for (int x = 0; x < PIECE_SIZE; ++x) {
			const int canvasX = destX + x;
			if (canvasX < 0 || canvasX >= canvasWidth) {
				continue;
			}
			const uint8_t colorIndex = indexed[y * PIECE_SIZE + x];
			if (colorIndex == colorKeyIndex) {
				continue; // transparente, não pinta sobre o que já está no canvas
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
			const int destX = topLeft.x + pieceCol * PIECE_SIZE;
			const int destY = topLeft.y + pieceRow * PIECE_SIZE;
			blitPiece(canvas, canvasWidth, canvasHeight, destX, destY, tilePixels, palette, colorKeyIndex,
			          cell.pieceIds[pieceRow][pieceCol]);
		}
	}
}

} // namespace

void writeTilesetPreview(const TilesetImportResult& result, const std::string& outputPngPath)
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
			         result.palette, result.colorKeyIndex);
			blitCell(canvas, canvasWidth, canvasHeight, topLeft, result.overlayGrid[row][col], result.tilePixels,
			         result.palette, result.colorKeyIndex);
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

void writeOutfitPreview(const OutfitImportResult& result, const std::string& outputPngPath)
{
	(void)result;
	(void)outputPngPath;
	throw std::logic_error("writeOutfitPreview: pendente de implementação (fase M2)");
}

} // namespace mvp::mapeditor::import
