#include "mvp/engine/palette.hpp"

namespace mvp::engine
{

Rgba resolveIndexedPixel(const std::array<shared::dat::PaletteEntry, 256>& palette, uint8_t colorKeyIndex,
                          uint8_t pixelIndex)
{
	if (pixelIndex == colorKeyIndex) {
		return Rgba{0, 0, 0, 0};
	}
	const shared::dat::PaletteEntry& entry = palette[pixelIndex];
	return Rgba{entry.r, entry.g, entry.b, 255};
}

} // namespace mvp::engine
