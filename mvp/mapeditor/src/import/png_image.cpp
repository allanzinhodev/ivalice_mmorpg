#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION

#include "png_image.hpp"

#include <stb_image.h>
#include <stb_image_write.h>

#include <stdexcept>

namespace mvp::mapeditor::import
{

PngImage loadPng(const std::string& path)
{
	int width = 0;
	int height = 0;
	int channels = 0;
	uint8_t* data = stbi_load(path.c_str(), &width, &height, &channels, 4);
	if (data == nullptr) {
		throw std::runtime_error("loadPng: cannot load " + path);
	}

	PngImage image;
	image.width = width;
	image.height = height;
	image.pixels.assign(data, data + (static_cast<size_t>(width) * height * 4));
	stbi_image_free(data);
	return image;
}

void writePng(const std::string& path, int width, int height, const std::vector<uint8_t>& rgbaPixels)
{
	const int stride = width * 4;
	if (stbi_write_png(path.c_str(), width, height, 4, rgbaPixels.data(), stride) == 0) {
		throw std::runtime_error("writePng: cannot write " + path);
	}
}

} // namespace mvp::mapeditor::import
