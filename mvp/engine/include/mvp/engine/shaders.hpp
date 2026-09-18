#pragma once

namespace mvp::engine::shaders
{

// Shader mínimo do sprite batch: quad texturizado com projeção ortográfica
// em pixels de tela (sem rotação/escala -- o MVP não precisa disso ainda).
inline constexpr const char* SPRITE_VERTEX = R"(
#version 330 core
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aTexCoord;

uniform mat4 uProjection;

out vec2 vTexCoord;

void main()
{
	gl_Position = uProjection * vec4(aPosition, 0.0, 1.0);
	vTexCoord = aTexCoord;
}
)";

inline constexpr const char* SPRITE_FRAGMENT = R"(
#version 330 core
in vec2 vTexCoord;
out vec4 fragColor;

uniform sampler2D uAtlas;

void main()
{
	vec4 color = texture(uAtlas, vTexCoord);
	if (color.a < 0.01) {
		discard;
	}
	fragColor = color;
}
)";

} // namespace mvp::engine::shaders
