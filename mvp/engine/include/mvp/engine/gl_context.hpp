#pragma once

#include <cstdint>
#include <string>

namespace mvp::engine
{

// Wrapper mínimo de shader/textura, o suficiente para o sprite batch da
// engine. Sem abstração de "material"/"pipeline" -- o MVP só desenha quads
// texturizados com paleta indexed resolvida em CPU (ver palette.hpp).
class Shader
{
public:
	Shader(const std::string& vertexSource, const std::string& fragmentSource);
	~Shader();

	Shader(const Shader&) = delete;
	Shader& operator=(const Shader&) = delete;

	void use() const;
	uint32_t id() const { return programId; }

private:
	uint32_t programId = 0;
};

class Texture2D
{
public:
	Texture2D(int width, int height, const uint8_t* rgbaPixels);
	~Texture2D();

	Texture2D(const Texture2D&) = delete;
	Texture2D& operator=(const Texture2D&) = delete;

	void bind(uint32_t slot = 0) const;
	uint32_t id() const { return textureId; }

private:
	uint32_t textureId = 0;
};

} // namespace mvp::engine
