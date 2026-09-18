#pragma once

#include <cstdint>
#include <memory>
#include <vector>

#include "mvp/engine/gl_context.hpp"

namespace mvp::engine
{

struct SpriteQuad
{
	int x = 0; // canto superior-esquerdo, em pixels de tela
	int y = 0;
	int width = 0;
	int height = 0;
	float u0 = 0.0f; // região da textura atlas a amostrar (0..1)
	float v0 = 0.0f;
	float u1 = 1.0f;
	float v1 = 1.0f;
	bool flipHorizontal = false;
};

// Batching simples de quads texturizados sobre uma única textura atlas.
// Sem culling nem ordenação por profundidade além da ordem de inserção --
// quem decide a ordem (terreno/overlay/personagem, ver dat_format.hpp e a
// regra de elevação do .mvpmap) é o chamador (mvp::client::MapView).
class SpriteBatch
{
public:
	explicit SpriteBatch(std::shared_ptr<Texture2D> atlas);

	void begin();
	void push(const SpriteQuad& quad);
	void end(const Shader& shader);

private:
	std::shared_ptr<Texture2D> atlas;
	std::vector<SpriteQuad> quads;
	uint32_t vertexArrayId = 0;
	uint32_t vertexBufferId = 0;
};

} // namespace mvp::engine
