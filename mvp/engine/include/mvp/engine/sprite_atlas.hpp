#pragma once

#include <memory>
#include <vector>

#include "mvp/engine/gl_context.hpp"
#include "mvp/shared/dat_format.hpp"

namespace mvp::engine
{

struct AtlasRegion
{
	float u0 = 0.0f;
	float v0 = 0.0f;
	float u1 = 1.0f;
	float v1 = 1.0f;
};

// Monta uma única textura atlas a partir de um buffer de sprites indexed
// de tamanho fixo (peças de tileset 16x16, ou frames de outfit 32x48),
// decodificando cada um para RGBA via a paleta global. Layout do atlas:
// grade simples, uma peça por célula -- suficiente para o volume do MVP
// (algumas centenas a poucos milhares de sprites), sem packing
// sofisticado.
class SpriteAtlas
{
public:
	SpriteAtlas(const std::vector<uint8_t>& indexedPixels, int pieceWidth, int pieceHeight, uint32_t pieceCount,
	            const std::array<shared::dat::PaletteEntry, 256>& palette, uint8_t colorKeyIndex);

	std::shared_ptr<Texture2D> texture() const { return texture_; }
	const AtlasRegion& region(uint32_t index) const { return regions[index]; }

private:
	std::shared_ptr<Texture2D> texture_;
	std::vector<AtlasRegion> regions;
};

} // namespace mvp::engine
