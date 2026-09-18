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

void writeDatAndSpr(const TilesetImportResult& tileset, const OutfitImportResult& outfit, const std::string& datPath,
                     const std::string& sprPath)
{
	// Grava o header + bloco tiles a partir do tileset já deduplicado; o
	// bloco creatures (outfit) é escrito quando outfit.creature já tiver
	// frameGroups populados (fase M2). itemsCount/effectsCount/missilesCount
	// ficam em 0 no MVP inicial (ver dat_format.hpp).
	ByteWriter datWriter;
	datWriter.writeU32(1); // signature v1
	datWriter.writeU16(static_cast<uint16_t>(tileset.tiles.size()));
	datWriter.writeU16(0); // itemsCount
	datWriter.writeU16(static_cast<uint16_t>(outfit.creature.frameGroups.empty() ? 0 : 1)); // creaturesCount
	datWriter.writeU16(0); // effectsCount
	datWriter.writeU16(0); // missilesCount

	for (const auto& tile : tileset.tiles) {
		datWriter.writeU8(static_cast<uint8_t>(tile.layer));
		datWriter.writeU32(tile.contentHash);
		datWriter.writeU16(tile.spriteIndex);
	}

	if (!outfit.creature.frameGroups.empty()) {
		datWriter.writeU8(static_cast<uint8_t>(outfit.creature.frameGroups.size()));
		for (const auto& group : outfit.creature.frameGroups) {
			datWriter.writeU8(static_cast<uint8_t>(group.frameGroupType));
			datWriter.writeU8(group.frameCount);
			datWriter.writeU8(group.hasWaterVariant ? 1 : 0);
			datWriter.writeU16(group.spriteIndexDrySouth);
			datWriter.writeU16(group.spriteIndexDryWest);
			datWriter.writeU16(group.spriteIndexWetSouth);
			datWriter.writeU16(group.spriteIndexWetWest);
		}
		datWriter.writeU8(outfit.creature.frameWidth);
		datWriter.writeU8(outfit.creature.frameHeight);
	}

	writeFile(datPath, datWriter.data());

	ByteWriter sprWriter;
	sprWriter.writeU32(1); // signature v1, deve bater com o .dat
	sprWriter.writeU16(256); // paletteSize
	sprWriter.writeU32(static_cast<uint32_t>(tileset.tiles.size())); // tileSpriteCount
	const uint32_t creatureSpriteCount =
	    outfit.creature.frameGroups.empty()
	        ? 0
	        : static_cast<uint32_t>(outfit.framePixels.size() / shared::dat::CREATURE_PIXELS);
	sprWriter.writeU32(creatureSpriteCount);
	sprWriter.writeU32(0); // itemSpriteCount
	sprWriter.writeU32(0); // effectSpriteCount
	sprWriter.writeU32(0); // missileSpriteCount

	// Paleta real (quantização compartilhada) chega na fase M1/M2 -- aqui
	// grava uma paleta vazia (256 entradas pretas) só para o layout do
	// arquivo ficar completo e o parser (loadSprFile) conseguir validar
	// tamanho/offsets já nesta fase M0.
	for (int i = 0; i < 256; ++i) {
		sprWriter.writeU8(0);
		sprWriter.writeU8(0);
		sprWriter.writeU8(0);
	}

	sprWriter.writeBytes(tileset.tilePixels.data(), tileset.tilePixels.size());
	sprWriter.writeBytes(outfit.framePixels.data(), outfit.framePixels.size());

	writeFile(sprPath, sprWriter.data());
}

} // namespace mvp::mapeditor::import
