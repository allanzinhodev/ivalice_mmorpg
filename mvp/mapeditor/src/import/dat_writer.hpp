#pragma once

#include <array>
#include <string>

#include "mvp/shared/dat_format.hpp"
#include "outfit_import.hpp"
#include "tile_dedup.hpp"

namespace mvp::mapeditor::import
{

// Grava o .dat/.spr definitivo. Só deve ser chamado depois de o preview ter
// sido aprovado explicitamente -- nunca automaticamente ao importar (regra 7
// do usuário: "o parse final só deve ser feito após eu confirmar").
// `palette` é a paleta global final (mesma instância compartilhada entre
// tileset e outfits durante o import, ver palette_builder.hpp).
void writeDatAndSpr(const TilesetImportResult& tileset, const OutfitImportResult& outfit,
                     const std::array<shared::dat::PaletteEntry, 256>& palette, const std::string& datPath,
                     const std::string& sprPath);

} // namespace mvp::mapeditor::import
