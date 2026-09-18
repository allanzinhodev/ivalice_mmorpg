#pragma once

#include <string>
#include <vector>

#include "mvp/shared/dat_format.hpp"
#include "palette_builder.hpp"

namespace mvp::mapeditor::import
{

struct OutfitImportResult
{
	std::vector<shared::dat::CreatureRecord> creatures; // uma por outfit, na ordem do outfits.json
	std::vector<uint8_t> framePixels;                    // todos os frames concatenados, indexed 32x48 cada
};

// Lê o diretório gerado por tools/ffta2-extract/export-outfits-png.js
// (outfits.json + PNGs por outfit/frameGroup/direção/fase/água) -- ver
// mvp/docs/formats/dat-spr-v1.md, seção "Pipeline de import: outfits".
// frameGroupType é o id bruto de animação do FFTA2 (sem classificação
// semântica ainda, ver dat_format.hpp).
//
// `paletteBuilder` é a MESMA instância usada pelo import de tileset -- a
// paleta de 256 cores é global e compartilhada; passar instâncias
// diferentes aqui e no tileset produz índices que não correspondem à
// paleta final montada por build(), corrompendo as cores no .spr.
OutfitImportResult importFftaOutfitsExport(const std::string& exportDir, PaletteBuilder& paletteBuilder);

} // namespace mvp::mapeditor::import
