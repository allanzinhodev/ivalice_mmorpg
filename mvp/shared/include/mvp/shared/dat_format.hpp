#pragma once

#include <cstdint>
#include <vector>

// Layout do .dat/.spr v1 do MVP. Ver mvp/docs/formats/dat-spr-v1.md para a
// descrição completa; este header só declara os tipos usados pelos parsers
// (mvp/engine) e pelo importador (mvp/mapeditor).
namespace mvp::shared::dat
{

struct DatHeader
{
	uint32_t signature = 0;
	uint16_t tilesCount = 0;
	uint16_t itemsCount = 0;
	uint16_t creaturesCount = 0;
	uint16_t effectsCount = 0;
	uint16_t missilesCount = 0;
};

// Tileset: puramente visual, sem flags de servidor, sem paleta trocável.
// "layer" só indica de qual PNG de origem a peça veio (terreno vs overlay) --
// não decide ordem de desenho em runtime; isso é resolvido comparando a
// elevação da célula (.mvpmap) com a altura do personagem.
enum class TileLayer : uint8_t
{
	Terrain = 0,
	Overlay = 1,
};

struct TileRecord
{
	TileLayer layer = TileLayer::Terrain;
	uint32_t contentHash = 0;
	uint16_t spriteIndex = 0;
};

struct ItemRecord
{
	uint32_t flags = 0;
	uint16_t spriteIndex = 0;
	uint8_t width = 1;
	uint8_t height = 1;
	uint8_t patternCount = 0;
};

// Mesmos 6 valores já validados no client atual (skill frame-groups) --
// nenhum grupo novo é inventado sem confirmação explícita durante o import.
enum class FrameGroupType : uint8_t
{
	Idle = 0,
	Walking = 1,
	Attacking = 2,
	Casting = 3,
	Hurt = 4,
	Dying = 5,
};

struct FrameGroupRecord
{
	FrameGroupType frameGroupType = FrameGroupType::Idle;
	uint8_t frameCount = 1;
	bool hasWaterVariant = false;
	uint16_t spriteIndexDrySouth = 0;
	uint16_t spriteIndexDryWest = 0;
	uint16_t spriteIndexWetSouth = 0; // == dry se !hasWaterVariant, nunca vazio
	uint16_t spriteIndexWetWest = 0;
};

struct CreatureRecord
{
	std::vector<FrameGroupRecord> frameGroups;
	uint8_t frameWidth = 32;
	uint8_t frameHeight = 64;
};

struct EffectRecord
{
	uint16_t spriteIndex = 0;
	uint8_t patternCount = 1;
};

struct MissileRecord
{
	uint16_t spriteIndex = 0;
	uint8_t patternCount = 1;
};

struct DatFile
{
	DatHeader header;
	std::vector<TileRecord> tiles;
	std::vector<ItemRecord> items;
	std::vector<CreatureRecord> creatures;
	std::vector<EffectRecord> effects;
	std::vector<MissileRecord> missiles;
};

struct PaletteEntry
{
	uint8_t r = 0;
	uint8_t g = 0;
	uint8_t b = 0;
};

constexpr int TILE_PIXELS = 16 * 16;
constexpr int CREATURE_PIXELS = 32 * 64;

struct SprHeader
{
	uint32_t signature = 0;
	uint16_t paletteSize = 256;
	uint32_t tileSpriteCount = 0;
	uint32_t creatureSpriteCount = 0;
	uint32_t itemSpriteCount = 0;
	uint32_t effectSpriteCount = 0;
	uint32_t missileSpriteCount = 0;
};

struct SprFile
{
	SprHeader header;
	std::vector<PaletteEntry> palette; // sempre 256 entradas no MVP
	std::vector<uint8_t> tilePixels;   // tileSpriteCount * TILE_PIXELS
	std::vector<uint8_t> creaturePixels; // creatureSpriteCount * CREATURE_PIXELS
};

} // namespace mvp::shared::dat
