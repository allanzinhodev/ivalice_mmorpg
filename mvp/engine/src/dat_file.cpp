#include "mvp/engine/dat_file.hpp"

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
		throw std::runtime_error("dat_file: cannot open " + path);
	}
	const std::streamsize size = file.tellg();
	std::vector<uint8_t> buffer(static_cast<size_t>(size));
	file.seekg(0);
	file.read(reinterpret_cast<char*>(buffer.data()), size);
	return buffer;
}

TileRecord readTileRecord(ByteReader& reader)
{
	TileRecord record;
	record.layer = static_cast<TileLayer>(reader.readU8());
	record.contentHash = reader.readU32();
	record.spriteIndex = reader.readU16();
	return record;
}

ItemRecord readItemRecord(ByteReader& reader)
{
	ItemRecord record;
	record.flags = reader.readU32();
	record.spriteIndex = reader.readU16();
	record.width = reader.readU8();
	record.height = reader.readU8();
	record.patternCount = reader.readU8();
	return record;
}

FramePhase readFramePhase(ByteReader& reader)
{
	FramePhase phase;
	phase.spriteIndexDrySouth = reader.readU16();
	phase.spriteIndexDryWest = reader.readU16();
	phase.spriteIndexWetSouth = reader.readU16();
	phase.spriteIndexWetWest = reader.readU16();
	return phase;
}

FrameGroupRecord readFrameGroupRecord(ByteReader& reader)
{
	FrameGroupRecord group;
	group.frameGroupType = reader.readU8();
	group.hasWaterVariant = reader.readU8() != 0;
	const uint8_t phaseCount = reader.readU8();
	group.phases.reserve(phaseCount);
	for (uint8_t i = 0; i < phaseCount; ++i) {
		group.phases.push_back(readFramePhase(reader));
	}
	return group;
}

CreatureRecord readCreatureRecord(ByteReader& reader)
{
	CreatureRecord creature;
	const uint8_t frameGroupCount = reader.readU8();
	creature.frameGroups.reserve(frameGroupCount);
	for (uint8_t i = 0; i < frameGroupCount; ++i) {
		creature.frameGroups.push_back(readFrameGroupRecord(reader));
	}
	creature.frameWidth = reader.readU8();
	creature.frameHeight = reader.readU8();
	return creature;
}

EffectRecord readEffectRecord(ByteReader& reader)
{
	EffectRecord effect;
	effect.spriteIndex = reader.readU16();
	effect.patternCount = reader.readU8();
	return effect;
}

MissileRecord readMissileRecord(ByteReader& reader)
{
	MissileRecord missile;
	missile.spriteIndex = reader.readU16();
	missile.patternCount = reader.readU8();
	return missile;
}

} // namespace

DatFile loadDatFile(const std::string& path)
{
	const std::vector<uint8_t> bytes = readWholeFile(path);
	ByteReader reader(bytes.data(), bytes.size());

	DatFile file;
	file.header.signature = reader.readU32();
	file.header.tilesCount = reader.readU16();
	file.header.itemsCount = reader.readU16();
	file.header.creaturesCount = reader.readU16();
	file.header.effectsCount = reader.readU16();
	file.header.missilesCount = reader.readU16();

	file.tiles.reserve(file.header.tilesCount);
	for (uint16_t i = 0; i < file.header.tilesCount; ++i) {
		file.tiles.push_back(readTileRecord(reader));
	}

	file.items.reserve(file.header.itemsCount);
	for (uint16_t i = 0; i < file.header.itemsCount; ++i) {
		file.items.push_back(readItemRecord(reader));
	}

	file.creatures.reserve(file.header.creaturesCount);
	for (uint16_t i = 0; i < file.header.creaturesCount; ++i) {
		file.creatures.push_back(readCreatureRecord(reader));
	}

	file.effects.reserve(file.header.effectsCount);
	for (uint16_t i = 0; i < file.header.effectsCount; ++i) {
		file.effects.push_back(readEffectRecord(reader));
	}

	file.missiles.reserve(file.header.missilesCount);
	for (uint16_t i = 0; i < file.header.missilesCount; ++i) {
		file.missiles.push_back(readMissileRecord(reader));
	}

	return file;
}

} // namespace mvp::engine
