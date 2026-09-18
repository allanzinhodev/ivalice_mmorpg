#include "mvp/engine/sprite_atlas.hpp"

#include <algorithm>
#include <array>
#include <cmath>

#include "mvp/engine/palette.hpp"

namespace mvp::engine
{

namespace
{

constexpr int PIECE_SIZE = 16;

} // namespace

SpriteAtlas::SpriteAtlas(const shared::dat::SprFile& sprFile, uint8_t colorKeyIndex)
{
	const uint32_t tileCount = sprFile.header.tileSpriteCount;
	tileRegions.resize(tileCount);

	if (tileCount == 0) {
		texture_ = std::make_shared<Texture2D>(1, 1, nullptr);
		return;
	}

	// Grade quadrada de peças 16x16 -- simples e suficiente para algumas
	// centenas de peças (M1). Uma peça por célula, sem packing sofisticado.
	const int columns = static_cast<int>(std::ceil(std::sqrt(static_cast<double>(tileCount))));
	const int rows = (static_cast<int>(tileCount) + columns - 1) / columns;
	const int atlasWidth = columns * PIECE_SIZE;
	const int atlasHeight = rows * PIECE_SIZE;

	std::array<shared::dat::PaletteEntry, 256> palette{};
	std::copy(sprFile.palette.begin(), sprFile.palette.end(), palette.begin());

	std::vector<uint8_t> atlasRgba(static_cast<size_t>(atlasWidth) * atlasHeight * 4, 0);

	for (uint32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {
		const int cellCol = static_cast<int>(tileIndex) % columns;
		const int cellRow = static_cast<int>(tileIndex) / columns;
		const int destX = cellCol * PIECE_SIZE;
		const int destY = cellRow * PIECE_SIZE;

		const uint8_t* indexed = &sprFile.tilePixels[static_cast<size_t>(tileIndex) * PIECE_SIZE * PIECE_SIZE];
		for (int y = 0; y < PIECE_SIZE; ++y) {
			for (int x = 0; x < PIECE_SIZE; ++x) {
				const uint8_t pixelIndex = indexed[y * PIECE_SIZE + x];
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
		region.u1 = static_cast<float>(destX + PIECE_SIZE) / static_cast<float>(atlasWidth);
		region.v1 = static_cast<float>(destY + PIECE_SIZE) / static_cast<float>(atlasHeight);
		tileRegions[tileIndex] = region;
	}

	texture_ = std::make_shared<Texture2D>(atlasWidth, atlasHeight, atlasRgba.data());
}

} // namespace mvp::engine
