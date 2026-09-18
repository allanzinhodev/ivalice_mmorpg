#include "mvp/engine/outfit_render.hpp"

namespace mvp::engine
{

OutfitDrawInfo resolveOutfitSprite(const shared::dat::FrameGroupRecord& group, RenderDirection direction, bool isWet)
{
	switch (direction) {
		case RenderDirection::South:
			return OutfitDrawInfo{isWet ? group.spriteIndexWetSouth : group.spriteIndexDrySouth, false};
		case RenderDirection::West:
			return OutfitDrawInfo{isWet ? group.spriteIndexWetWest : group.spriteIndexDryWest, false};
		case RenderDirection::North:
			// Norte = Oeste espelhado horizontalmente.
			return OutfitDrawInfo{isWet ? group.spriteIndexWetWest : group.spriteIndexDryWest, true};
		case RenderDirection::East:
			// Leste = Sul espelhado horizontalmente.
			return OutfitDrawInfo{isWet ? group.spriteIndexWetSouth : group.spriteIndexDrySouth, true};
	}
	return OutfitDrawInfo{};
}

} // namespace mvp::engine
