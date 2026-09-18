#pragma once

#include <string>

#include "outfit_import.hpp"
#include "tile_dedup.hpp"

namespace mvp::mapeditor::import
{

// Grava o .dat/.spr definitivo. Só deve ser chamado depois de o preview ter
// sido aprovado explicitamente -- nunca automaticamente ao importar (regra 7
// do usuário: "o parse final só deve ser feito após eu confirmar").
void writeDatAndSpr(const TilesetImportResult& tileset, const OutfitImportResult& outfit, const std::string& datPath,
                     const std::string& sprPath);

} // namespace mvp::mapeditor::import
