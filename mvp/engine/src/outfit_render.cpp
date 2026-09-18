#include "mvp/engine/outfit_render.hpp"

namespace mvp::engine
{

OutfitDrawInfo resolveOutfitSprite(const shared::dat::FrameGroupRecord& group, uint8_t phaseIndex,
                                     RenderDirection direction, bool isWet)
{
	const shared::dat::FramePhase& phase = group.phases[phaseIndex];
	switch (direction) {
		case RenderDirection::South:
			return OutfitDrawInfo{isWet ? phase.spriteIndexWetSouth : phase.spriteIndexDrySouth, false};
		case RenderDirection::West:
			return OutfitDrawInfo{isWet ? phase.spriteIndexWetWest : phase.spriteIndexDryWest, false};
		case RenderDirection::North:
			// Norte = Oeste espelhado horizontalmente.
			return OutfitDrawInfo{isWet ? phase.spriteIndexWetWest : phase.spriteIndexDryWest, true};
		case RenderDirection::East:
			// Leste = Sul espelhado horizontalmente.
			return OutfitDrawInfo{isWet ? phase.spriteIndexWetSouth : phase.spriteIndexDrySouth, true};
	}
	return OutfitDrawInfo{};
}

} // namespace mvp::engine
