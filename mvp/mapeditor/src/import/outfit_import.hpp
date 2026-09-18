#pragma once

#include <string>
#include <vector>

#include "mvp/shared/dat_format.hpp"

namespace mvp::mapeditor::import
{

struct OutfitImportResult
{
	shared::dat::CreatureRecord creature;
	std::vector<uint8_t> framePixels; // frameCount * CREATURE_PIXELS, indexed
};

// Lê a spritesheet do FFTA2 (ordem de coluna Norte/Leste/Sul/Oeste, frame de
// entrada 24x48), descarta Norte/Leste, realinha Sul/Oeste para 32x64, e
// classifica cada bloco de colunas num FrameGroupType -- com preview
// obrigatório antes de qualquer gravação definitiva (regra 7 do usuário).
// Implementação real chega na fase M2.
OutfitImportResult importFftaOutfitSpritesheet(const std::string& spritesheetPath);

} // namespace mvp::mapeditor::import
