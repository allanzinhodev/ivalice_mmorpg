#pragma once

#include <string>

#include "../import/tile_dedup.hpp"

namespace mvp::mapeditor::map_editor
{

// Grava server/data/maps/aizenfield.mvpmap a partir da grade produzida pelo
// import de tileset (terrainGrid/overlayGrid, ver tile_dedup.hpp) e da
// elevação por célula (height map do Aizenfield, se disponível -- skill
// ffta-map -- senão 0 uniforme, conforme decisão do plano M1).
void writeMvpMap(const import::TilesetImportResult& tileset, const std::string& outputPath);

} // namespace mvp::mapeditor::map_editor
