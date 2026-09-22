#include "mvp/engine/sprite_atlas.hpp"

#include <algorithm>
#include <array>
#include <cmath>

#include "mvp/engine/palette.hpp"

namespace mvp::engine
{

SpriteAtlas::SpriteAtlas(const std::vector<uint8_t>& indexedPixels, int pieceWidth, int pieceHeight,
                           uint32_t pieceCount, const std::array<shared::dat::PaletteEntry, 256>& palette,
                           uint8_t colorKeyIndex)
{
	regions.resize(pieceCount);

	if (pieceCount == 0) {
		texture_ = std::make_shared<Texture2D>(1, 1, nullptr);
		return;
	}

	// Grade quadrada de peças, uma por célula -- simples e suficiente para
	// o volume do MVP (tiles: centenas; frames de outfit: poucos milhares).
	const int columns = static_cast<int>(std::ceil(std::sqrt(static_cast<double>(pieceCount))));
	const int rows = (static_cast<int>(pieceCount) + columns - 1) / columns;
	const int atlasWidth = columns * pieceWidth;
	const int atlasHeight = rows * pieceHeight;

	std::vector<uint8_t> atlasRgba(static_cast<size_t>(atlasWidth) * atlasHeight * 4, 0);

	for (uint32_t pieceIndex = 0; pieceIndex < pieceCount; ++pieceIndex) {
		const int cellCol = static_cast<int>(pieceIndex) % columns;
		const int cellRow = static_cast<int>(pieceIndex) / columns;
		const int destX = cellCol * pieceWidth;
		const int destY = cellRow * pieceHeight;

		const uint8_t* indexed = &indexedPixels[static_cast<size_t>(pieceIndex) * pieceWidth * pieceHeight];
		for (int y = 0; y < pieceHeight; ++y) {
			for (int x = 0; x < pieceWidth; ++x) {
				const uint8_t pixelIndex = indexed[y * pieceWidth + x];
				const Rgba color = resolveIndexedPixel(palette, colorKeyIndex, pixelIndex);

				const size_t dstOffset = (static_cast<size_t>(destY + y) * atlasWidth + (destX + x)) * 4;
				atlasRgba[dstOffset + 0] = color.r;
				atlasRgba[dstOffset + 1] = color.g;
				atlasRgba[dstOffset + 2] = color.b;
				atlasRgba[dstOffset + 3] = color.a;
			}
		}

		AtlasRegion region;
		region.u0 = static_cast<float>(destX) / static_cast<float>(atlasWidth);
		region.v0 = static_cast<float>(destY) / static_cast<float>(atlasHeight);
		region.u1 = static_cast<float>(destX + pieceWidth) / static_cast<float>(atlasWidth);
		region.v1 = static_cast<float>(destY + pieceHeight) / static_cast<float>(atlasHeight);
		regions[pieceIndex] = region;
	}

	texture_ = std::make_shared<Texture2D>(atlasWidth, atlasHeight, atlasRgba.data());
}

} // namespace mvp::engine
