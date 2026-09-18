#include "outfit_import.hpp"

#include <fstream>
#include <map>
#include <sstream>
#include <stdexcept>

#include "json_value.hpp"
#include "palette_builder.hpp"
#include "png_image.hpp"

namespace mvp::mapeditor::import
{

using shared::dat::CreatureRecord;
using shared::dat::FrameGroupRecord;
using shared::dat::FramePhase;

namespace
{

constexpr int FRAME_W = 32;
constexpr int FRAME_H = 48;

std::string readWholeFile(const std::string& path)
{
	std::ifstream file(path);
	if (!file) {
		throw std::runtime_error("importFftaOutfitsExport: cannot open " + path);
	}
	std::ostringstream buffer;
	buffer << file.rdbuf();
	return buffer.str();
}

// Quantiza um PNG 32x48 RGBA para bytes indexed usando a paleta
// compartilhada, e devolve o índice do frame dentro de framePixels
// (dedup por conteúdo já indexado -- frames idênticos entre grupos/fases
// compartilham índice, ver dat-spr-v1.md).
class FrameBank
{
public:
	explicit FrameBank(PaletteBuilder& paletteBuilder) : paletteBuilder(paletteBuilder) {}

	uint16_t insert(const PngImage& image)
	{
		if (image.width != FRAME_W || image.height != FRAME_H) {
			throw std::runtime_error("importFftaOutfitsExport: frame com dimensão inesperada");
		}

		std::vector<uint8_t> indexed(FRAME_W * FRAME_H);
		for (int i = 0; i < FRAME_W * FRAME_H; ++i) {
			const uint8_t r = image.pixels[i * 4 + 0];
			const uint8_t g = image.pixels[i * 4 + 1];
			const uint8_t b = image.pixels[i * 4 + 2];
			const uint8_t a = image.pixels[i * 4 + 3];
			indexed[i] = paletteBuilder.indexFor(r, g, b, a == 0);
		}

		const std::string key(reinterpret_cast<const char*>(indexed.data()), indexed.size());
		auto it = byContent.find(key);
		if (it != byContent.end()) {
			return it->second;
		}

		const uint16_t newIndex = static_cast<uint16_t>(frameCount);
		framePixels.insert(framePixels.end(), indexed.begin(), indexed.end());
		byContent.emplace(key, newIndex);
		++frameCount;
		return newIndex;
	}

	std::vector<uint8_t> framePixels;

private:
	PaletteBuilder& paletteBuilder;
	std::map<std::string, uint16_t> byContent;
	size_t frameCount = 0;
};

uint16_t loadFrameSprite(FrameBank& bank, const std::string& dir, const std::string& fileName)
{
	const PngImage image = loadPng(dir + "/" + fileName);
	return bank.insert(image);
}

FramePhase readFramePhase(FrameBank& bank, const std::string& unitDir, const JsonValue& frameEntry)
{
	FramePhase phase;

	const JsonValue& dry = frameEntry.at("dry");
	const JsonValue& wet = frameEntry.at("wet");

	if (dry.has("south")) {
		phase.spriteIndexDrySouth = loadFrameSprite(bank, unitDir, dry.at("south").asString());
	}
	if (dry.has("west")) {
		phase.spriteIndexDryWest = loadFrameSprite(bank, unitDir, dry.at("west").asString());
	}

	// Água nunca fica vazia: se não houver variante molhada nesta fase,
	// repete o índice seco (regra 6 do briefing original).
	phase.spriteIndexWetSouth =
	    wet.has("south") ? loadFrameSprite(bank, unitDir, wet.at("south").asString()) : phase.spriteIndexDrySouth;
	phase.spriteIndexWetWest =
	    wet.has("west") ? loadFrameSprite(bank, unitDir, wet.at("west").asString()) : phase.spriteIndexDryWest;

	return phase;
}

} // namespace

OutfitImportResult importFftaOutfitsExport(const std::string& exportDir, PaletteBuilder& paletteBuilder)
{
	const std::string manifestText = readWholeFile(exportDir + "/outfits.json");
	const JsonValue manifest = parseJson(manifestText);

	if (manifest.type != JsonValue::Type::Array) {
		throw std::runtime_error("importFftaOutfitsExport: outfits.json não é um array");
	}

	OutfitImportResult result;
	FrameBank bank(paletteBuilder);

	for (const JsonValue& outfitEntry : manifest.array) {
		const int outfitId = outfitEntry.at("id").asInt();
		const std::string unitDir = exportDir + "/" + std::to_string(outfitId);

		CreatureRecord creature;

		for (const JsonValue& groupEntry : outfitEntry.at("groups").array) {
			FrameGroupRecord group;
			group.frameGroupType = static_cast<uint8_t>(groupEntry.at("type").asInt());

			bool anyWaterVariant = false;
			for (const JsonValue& frameEntry : groupEntry.at("frames").array) {
				if (frameEntry.at("wet").has("south") || frameEntry.at("wet").has("west")) {
					anyWaterVariant = true;
				}
				group.phases.push_back(readFramePhase(bank, unitDir, frameEntry));
			}
			group.hasWaterVariant = anyWaterVariant;

			creature.frameGroups.push_back(std::move(group));
		}

		result.creatures.push_back(std::move(creature));
	}

	result.framePixels = std::move(bank.framePixels);
	return result;
}

} // namespace mvp::mapeditor::import
