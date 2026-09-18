#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "mvp/shared/dat_format.hpp"

namespace mvp::mapeditor::import
{

struct TilesetImportResult
{
	std::vector<shared::dat::TileRecord> tiles;
	std::vector<uint8_t> tilePixels; // tileCount * TILE_PIXELS, indexed
	std::vector<std::vector<uint16_t>> terrainGrid; // [row][col*2 + half] -> índice em tiles
	std::vector<std::vector<uint16_t>> overlayGrid; // idem, para aizenfield2.png
	uint16_t widthCells = 0;
	uint16_t heightCells = 0;
};

// Recorta terrainPng/overlayPng em peças 16x16, deduplica por hash de
// conteúdo já quantizado, e monta a grade de referências para o .mvpmap.
// Implementação real (quantização + hash FNV-1a) chega na fase M1 -- ver
// mvp/docs/formats/dat-spr-v1.md, seção "Pipeline de import".
TilesetImportResult importAizenfieldTileset(const std::string& terrainPngPath, const std::string& overlayPngPath);

} // namespace mvp::mapeditor::import
