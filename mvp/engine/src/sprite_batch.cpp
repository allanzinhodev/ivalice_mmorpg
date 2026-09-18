#include "mvp/engine/sprite_batch.hpp"

#include <GL/glew.h>

namespace mvp::engine
{

namespace
{

// x, y, u, v por vértice; 6 vértices por quad (dois triângulos).
constexpr int FLOATS_PER_VERTEX = 4;
constexpr int VERTICES_PER_QUAD = 6;

} // namespace

SpriteBatch::SpriteBatch(std::shared_ptr<Texture2D> atlas) : atlas(std::move(atlas))
{
	glGenVertexArrays(1, &vertexArrayId);
	glGenBuffers(1, &vertexBufferId);

	glBindVertexArray(vertexArrayId);
	glBindBuffer(GL_ARRAY_BUFFER, vertexBufferId);
	glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, FLOATS_PER_VERTEX * sizeof(float), reinterpret_cast<void*>(0));
	glEnableVertexAttribArray(0);
	glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, FLOATS_PER_VERTEX * sizeof(float),
	                       reinterpret_cast<void*>(2 * sizeof(float)));
	glEnableVertexAttribArray(1);
	glBindVertexArray(0);
}

void SpriteBatch::begin()
{
	quads.clear();
}

void SpriteBatch::push(const SpriteQuad& quad)
{
	quads.push_back(quad);
}

void SpriteBatch::end(const Shader& shader)
{
	if (quads.empty()) {
		return;
	}

	std::vector<float> vertices;
	vertices.reserve(quads.size() * VERTICES_PER_QUAD * FLOATS_PER_VERTEX);

	for (const SpriteQuad& quad : quads) {
		const float left = static_cast<float>(quad.x);
		const float right = static_cast<float>(quad.x + quad.width);
		const float top = static_cast<float>(quad.y);
		const float bottom = static_cast<float>(quad.y + quad.height);
		const float u0 = quad.flipHorizontal ? 1.0f : 0.0f;
		const float u1 = quad.flipHorizontal ? 0.0f : 1.0f;

		const float quadVertices[VERTICES_PER_QUAD][FLOATS_PER_VERTEX] = {
		    {left, top, u0, 0.0f},     {right, top, u1, 0.0f},    {left, bottom, u0, 1.0f},
		    {right, top, u1, 0.0f},    {right, bottom, u1, 1.0f}, {left, bottom, u0, 1.0f},
		};
		for (const auto& vertex : quadVertices) {
			vertices.insert(vertices.end(), vertex, vertex + FLOATS_PER_VERTEX);
		}
	}

	shader.use();
	atlas->bind(0);

	glBindVertexArray(vertexArrayId);
	glBindBuffer(GL_ARRAY_BUFFER, vertexBufferId);
	glBufferData(GL_ARRAY_BUFFER, static_cast<long>(vertices.size() * sizeof(float)), vertices.data(),
	             GL_DYNAMIC_DRAW);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<int>(quads.size() * VERTICES_PER_QUAD));
	glBindVertexArray(0);
}

} // namespace mvp::engine
