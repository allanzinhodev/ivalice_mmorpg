#include "mvp/engine/gl_context.hpp"

#include <GL/glew.h>

#include <stdexcept>
#include <vector>

namespace mvp::engine
{

namespace
{

uint32_t compileShaderStage(uint32_t stage, const std::string& source)
{
	const uint32_t shader = glCreateShader(stage);
	const char* sourcePtr = source.c_str();
	glShaderSource(shader, 1, &sourcePtr, nullptr);
	glCompileShader(shader);

	int compiled = GL_FALSE;
	glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
	if (compiled == GL_FALSE) {
		int logLength = 0;
		glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &logLength);
		std::vector<char> log(static_cast<size_t>(logLength));
		glGetShaderInfoLog(shader, logLength, nullptr, log.data());
		glDeleteShader(shader);
		throw std::runtime_error(std::string("Shader::compile failed: ") + log.data());
	}
	return shader;
}

} // namespace

Shader::Shader(const std::string& vertexSource, const std::string& fragmentSource)
{
	const uint32_t vertexShader = compileShaderStage(GL_VERTEX_SHADER, vertexSource);
	const uint32_t fragmentShader = compileShaderStage(GL_FRAGMENT_SHADER, fragmentSource);

	programId = glCreateProgram();
	glAttachShader(programId, vertexShader);
	glAttachShader(programId, fragmentShader);
	glLinkProgram(programId);

	glDeleteShader(vertexShader);
	glDeleteShader(fragmentShader);

	int linked = GL_FALSE;
	glGetProgramiv(programId, GL_LINK_STATUS, &linked);
	if (linked == GL_FALSE) {
		int logLength = 0;
		glGetProgramiv(programId, GL_INFO_LOG_LENGTH, &logLength);
		std::vector<char> log(static_cast<size_t>(logLength));
		glGetProgramInfoLog(programId, logLength, nullptr, log.data());
		glDeleteProgram(programId);
		throw std::runtime_error(std::string("Shader::link failed: ") + log.data());
	}
}

Shader::~Shader()
{
	if (programId != 0) {
		glDeleteProgram(programId);
	}
}

void Shader::use() const
{
	glUseProgram(programId);
}

Texture2D::Texture2D(int width, int height, const uint8_t* rgbaPixels)
{
	glGenTextures(1, &textureId);
	glBindTexture(GL_TEXTURE_2D, textureId);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, rgbaPixels);
}

Texture2D::~Texture2D()
{
	if (textureId != 0) {
		glDeleteTextures(1, &textureId);
	}
}

void Texture2D::bind(uint32_t slot) const
{
	glActiveTexture(GL_TEXTURE0 + slot);
	glBindTexture(GL_TEXTURE_2D, textureId);
}

} // namespace mvp::engine
