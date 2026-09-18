#include "mvp/shared/map_file.hpp"

#include <fstream>
#include <stdexcept>

#include "mvp/shared/byte_stream.hpp"

namespace mvp::shared::map
{

using mvp::shared::ByteReader;

namespace
{

std::vector<uint8_t> readWholeFile(const std::string& path)
{
	std::ifstream file(path, std::ios::binary | std::ios::ate);
	if (!file) {
		throw std::runtime_error("map_file: cannot open " + path);
	}
	const std::streamsize size = file.tellg();
	std::vector<uint8_t> buffer(static_cast<size_t>(size));
	file.seekg(0);
	file.read(reinterpret_cast<char*>(buffer.data()), size);
	return buffer;
}

Cell readCell(ByteReader& reader)
{
	Cell cell;
	for (int row = 0; row < PIECE_ROWS_PER_CELL; ++row) {
		for (int col = 0; col < PIECE_COLS_PER_CELL; ++col) {
			cell.terrainPieceIds[row][col] = reader.readU16();
		}
	}
	for (int row = 0; row < PIECE_ROWS_PER_CELL; ++row) {
		for (int col = 0; col < PIECE_COLS_PER_CELL; ++col) {
			cell.overlayPieceIds[row][col] = reader.readU16();
		}
	}
	cell.elevation = reader.readU8();
	return cell;
}

} // namespace

MapData loadMapFile(const std::string& path)
{
	const std::vector<uint8_t> bytes = readWholeFile(path);
	ByteReader reader(bytes.data(), bytes.size());

	MapData data;
	reader.readU32(); // signature -- validado pelo mapeditor no import, não pelo leitor
	data.width = reader.readU16();
	data.height = reader.readU16();

	data.cells.reserve(static_cast<size_t>(data.width) * data.height);
	for (uint32_t i = 0; i < static_cast<uint32_t>(data.width) * data.height; ++i) {
		data.cells.push_back(readCell(reader));
	}

	return data;
}

} // namespace mvp::shared::map
