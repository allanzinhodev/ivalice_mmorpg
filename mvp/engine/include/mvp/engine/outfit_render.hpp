#pragma once

#include "mvp/shared/dat_format.hpp"
#include "mvp/shared/protocol_messages.hpp"

namespace mvp::engine
{

enum class RenderDirection : uint8_t
{
	South = 0,
	West = 1,
	North = 2, // derivado de West via flip horizontal de UV
	East = 3,  // derivado de South via flip horizontal de UV
};

struct OutfitDrawInfo
{
	uint16_t spriteIndex = 0;
	bool flipHorizontal = false;
};

// Só Sul e Oeste existem como dado gravado no .spr (ver dat_format.hpp,
// FramePhase). Norte deriva de Oeste e Leste deriva de Sul, sempre por
// flip horizontal de UV -- nunca há pixel gravado para essas duas direções.
OutfitDrawInfo resolveOutfitSprite(const shared::dat::FrameGroupRecord& group, uint8_t phaseIndex,
                                    RenderDirection direction, bool isWet);

} // namespace mvp::engine
