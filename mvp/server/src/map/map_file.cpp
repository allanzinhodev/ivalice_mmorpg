#include "map_file.hpp"

#include <fstream>
#include <stdexcept>

#include "mvp/shared/byte_stream.hpp"

namespace mvp::server::map
{

using shared::ByteReader;

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
	cell.tileLeftId = reader.readU16();
	cell.tileRightId = reader.readU16();
	const uint8_t overlayCount = reader.readU8();
	cell.overlayIds.reserve(overlayCount);
	for (uint8_t i = 0; i < overlayCount; ++i) {
		cell.overlayIds.push_back(reader.readU16());
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
	reader.readU32(); // signature -- validado pelo mapeditor no import, não pelo server
	data.width = reader.readU16();
	data.height = reader.readU16();

	data.cells.reserve(static_cast<size_t>(data.width) * data.height);
	for (uint32_t i = 0; i < static_cast<uint32_t>(data.width) * data.height; ++i) {
		data.cells.push_back(readCell(reader));
	}

	return data;
}

} // namespace mvp::server::map
