#include "dat_writer.hpp"

#include <fstream>
#include <stdexcept>

#include "mvp/shared/byte_stream.hpp"

namespace mvp::mapeditor::import
{

using shared::ByteWriter;

namespace
{

void writeFile(const std::string& path, const std::vector<uint8_t>& bytes)
{
	std::ofstream file(path, std::ios::binary);
	if (!file) {
		throw std::runtime_error("dat_writer: cannot open " + path + " for writing");
	}
	file.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
}

} // namespace

void writeDatAndSpr(const TilesetImportResult& tileset, const OutfitImportResult& outfit,
                     const std::array<shared::dat::PaletteEntry, 256>& palette, const std::string& datPath,
                     const std::string& sprPath)
{
	ByteWriter datWriter;
	datWriter.writeU32(1); // signature v1
	datWriter.writeU16(static_cast<uint16_t>(tileset.tiles.size()));
	datWriter.writeU16(0); // itemsCount
	datWriter.writeU16(static_cast<uint16_t>(outfit.creatures.size()));
	datWriter.writeU16(0); // effectsCount
	datWriter.writeU16(0); // missilesCount

	for (const auto& tile : tileset.tiles) {
		datWriter.writeU8(static_cast<uint8_t>(tile.layer));
		datWriter.writeU32(tile.contentHash);
		datWriter.writeU16(tile.spriteIndex);
	}

	for (const auto& creature : outfit.creatures) {
		datWriter.writeU8(static_cast<uint8_t>(creature.frameGroups.size()));
		for (const auto& group : creature.frameGroups) {
			datWriter.writeU8(group.frameGroupType);
			datWriter.writeU8(group.hasWaterVariant ? 1 : 0);
			datWriter.writeU8(static_cast<uint8_t>(group.phases.size()));
			for (const auto& phase : group.phases) {
				datWriter.writeU16(phase.spriteIndexDrySouth);
				datWriter.writeU16(phase.spriteIndexDryWest);
				datWriter.writeU16(phase.spriteIndexWetSouth);
				datWriter.writeU16(phase.spriteIndexWetWest);
			}
		}
		datWriter.writeU8(creature.frameWidth);
		datWriter.writeU8(creature.frameHeight);
	}

	writeFile(datPath, datWriter.data());

	ByteWriter sprWriter;
	sprWriter.writeU32(1); // signature v1, deve bater com o .dat
	sprWriter.writeU16(256); // paletteSize
	sprWriter.writeU32(static_cast<uint32_t>(tileset.tiles.size())); // tileSpriteCount
	sprWriter.writeU32(static_cast<uint32_t>(outfit.framePixels.size() / shared::dat::CREATURE_PIXELS));
	sprWriter.writeU32(0); // itemSpriteCount
	sprWriter.writeU32(0); // effectSpriteCount
	sprWriter.writeU32(0); // missileSpriteCount

	for (const auto& entry : palette) {
		sprWriter.writeU8(entry.r);
		sprWriter.writeU8(entry.g);
		sprWriter.writeU8(entry.b);
	}

	sprWriter.writeBytes(tileset.tilePixels.data(), tileset.tilePixels.size());
	sprWriter.writeBytes(outfit.framePixels.data(), outfit.framePixels.size());

	writeFile(sprPath, sprWriter.data());
}

} // namespace mvp::mapeditor::import
