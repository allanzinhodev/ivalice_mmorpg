#pragma once

#include <string>

#include "outfit_import.hpp"
#include "tile_dedup.hpp"

namespace mvp::mapeditor::import
{

// Renderiza PNGs de depuração (sem UI/ImGui, ver decisão de bibliotecas do
// plano) para o usuário aprovar visualmente antes da gravação definitiva:
// - tileset: reconstrução da cena a partir dos ids deduplicados, comparada
//   contra aizenfield3.png (gabarito sem personagem).
// - outfit: miniatura + rótulo de frameGroupType inferido por bloco de
//   colunas da spritesheet.
// Implementação real chega junto com tile_dedup/outfit_import (M1/M2).
void writeTilesetPreview(const TilesetImportResult& result, const std::string& outputPngPath);
void writeOutfitPreview(const OutfitImportResult& result, const std::string& outputPngPath);

} // namespace mvp::mapeditor::import
