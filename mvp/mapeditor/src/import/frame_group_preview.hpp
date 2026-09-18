#pragma once

#include <array>
#include <string>

#include "mvp/shared/dat_format.hpp"
#include "outfit_import.hpp"
#include "tile_dedup.hpp"

namespace mvp::mapeditor::import
{

// Renderiza PNGs de depuração (sem UI/ImGui, ver decisão de bibliotecas do
// plano) para o usuário aprovar visualmente antes da gravação definitiva:
// - tileset: reconstrução da cena a partir dos ids deduplicados, comparada
//   contra aizenfield3.png (gabarito sem personagem).
// - outfit: mosaico com a primeira fase (Sul, seco) de cada frame group de
//   cada outfit, para inspeção visual rápida antes de gravar.
// `palette` é a paleta global final compartilhada entre tileset e outfits.
void writeTilesetPreview(const TilesetImportResult& result, const std::array<shared::dat::PaletteEntry, 256>& palette,
                          uint8_t colorKeyIndex, const std::string& outputPngPath);
void writeOutfitPreview(const OutfitImportResult& result, const std::array<shared::dat::PaletteEntry, 256>& palette,
                         uint8_t colorKeyIndex, const std::string& outputPngPath);

} // namespace mvp::mapeditor::import
