#include "mvp/engine/spr_file.hpp"

#include <fstream>
#include <stdexcept>

#include "mvp/shared/byte_stream.hpp"

namespace mvp::engine
{

using namespace shared::dat;
using shared::ByteReader;

namespace
{

std::vector<uint8_t> readWholeFile(const std::string& path)
{
	std::ifstream file(path, std::ios::binary | std::ios::ate);
	if (!file) {
		throw std::runtime_error("spr_file: cannot open " + path);
	}
	const std::streamsize size = file.tellg();
	std::vector<uint8_t> buffer(static_cast<size_t>(size));
	file.seekg(0);
	file.read(reinterpret_cast<char*>(buffer.data()), size);
	return buffer;
}

} // namespace

SprFile loadSprFile(const std::string& path)
{
	const std::vector<uint8_t> bytes = readWholeFile(path);
	ByteReader reader(bytes.data(), bytes.size());

	SprFile file;
	file.header.signature = reader.readU32();
	file.header.paletteSize = reader.readU16();
	file.header.tileSpriteCount = reader.readU32();
	file.header.creatureSpriteCount = reader.readU32();
	file.header.itemSpriteCount = reader.readU32();
	file.header.effectSpriteCount = reader.readU32();
	file.header.missileSpriteCount = reader.readU32();

	file.palette.reserve(file.header.paletteSize);
	for (uint16_t i = 0; i < file.header.paletteSize; ++i) {
		PaletteEntry entry;
		entry.r = reader.readU8();
		entry.g = reader.readU8();
		entry.b = reader.readU8();
		file.palette.push_back(entry);
	}

	file.tilePixels.resize(static_cast<size_t>(file.header.tileSpriteCount) * TILE_PIXELS);
	if (!file.tilePixels.empty()) {
		reader.readBytes(file.tilePixels.data(), file.tilePixels.size());
	}

	file.creaturePixels.resize(static_cast<size_t>(file.header.creatureSpriteCount) * CREATURE_PIXELS);
	if (!file.creaturePixels.empty()) {
		reader.readBytes(file.creaturePixels.data(), file.creaturePixels.size());
	}

	return file;
}

} // namespace mvp::engine
