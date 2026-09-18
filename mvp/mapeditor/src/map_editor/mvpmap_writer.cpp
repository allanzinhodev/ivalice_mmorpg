#include "mvpmap_writer.hpp"

#include <fstream>
#include <stdexcept>

#include "mvp/shared/byte_stream.hpp"

namespace mvp::mapeditor::map_editor
{

using shared::ByteWriter;

namespace
{

void writeFile(const std::string& path, const std::vector<uint8_t>& bytes)
{
	std::ofstream file(path, std::ios::binary);
	if (!file) {
		throw std::runtime_error("mvpmap_writer: cannot open " + path + " for writing");
	}
	file.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
}

void writePieceGrid(ByteWriter& writer, const import::MapCellPieces& cell)
{
	for (int row = 0; row < import::PIECE_ROWS_PER_CELL; ++row) {
		for (int col = 0; col < import::PIECE_COLS_PER_CELL; ++col) {
			const uint16_t index = cell.pieceIds[row][col];
			writer.writeU16(index == import::EMPTY_TILE_INDEX ? 0xFFFF : index);
		}
	}
}

} // namespace

void writeMvpMap(const import::TilesetImportResult& tileset, const std::string& outputPath)
{
	if (tileset.terrainGrid.empty()) {
		throw std::runtime_error("writeMvpMap: grade de terreno vazia");
	}

	ByteWriter writer;
	writer.writeU32(1); // signature v1
	writer.writeU16(tileset.widthCells);
	writer.writeU16(tileset.heightCells);

	for (uint16_t row = 0; row < tileset.heightCells; ++row) {
		for (uint16_t col = 0; col < tileset.widthCells; ++col) {
			const import::MapCellPieces& terrainCell = tileset.terrainGrid[row][col];
			const import::MapCellPieces& overlayCell = tileset.overlayGrid[row][col];

			writePieceGrid(writer, terrainCell);
			writePieceGrid(writer, overlayCell);
			writer.writeU8(terrainCell.elevation);
		}
	}

	writeFile(outputPath, writer.data());
}

} // namespace mvp::mapeditor::map_editor
