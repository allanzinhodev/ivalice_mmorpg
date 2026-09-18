#pragma once

#include <array>
#include <cstdint>

#include "mvp/shared/dat_format.hpp"

namespace mvp::engine
{

struct Rgba
{
	uint8_t r = 0;
	uint8_t g = 0;
	uint8_t b = 0;
	uint8_t a = 255;
};

// Resolve um pixel indexed (0..255) para RGBA usando a paleta global do
// .spr. O índice reservado para o colorkey (#ff00ff na importação, ver
// mvp/docs/formats/dat-spr-v1.md) resolve para alpha 0.
Rgba resolveIndexedPixel(const std::array<shared::dat::PaletteEntry, 256>& palette, uint8_t colorKeyIndex,
                          uint8_t pixelIndex);

} // namespace mvp::engine
