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

// Monta uma única textura atlas a partir das peças de tileset (16x16
// indexed) do .spr, decodificando cada uma para RGBA via a paleta global.
// Layout do atlas: grade simples, colunas fixas, uma peça por célula --
// suficiente para o volume de peças do MVP (algumas centenas), sem
// packing sofisticado.
class SpriteAtlas
{
public:
	SpriteAtlas(const shared::dat::SprFile& sprFile, uint8_t colorKeyIndex);

	std::shared_ptr<Texture2D> texture() const { return texture_; }
	const AtlasRegion& tileRegion(uint16_t tileIndex) const { return tileRegions[tileIndex]; }

private:
	std::shared_ptr<Texture2D> texture_;
	std::vector<AtlasRegion> tileRegions;
};

} // namespace mvp::engine
