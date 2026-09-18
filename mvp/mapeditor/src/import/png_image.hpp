#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace mvp::mapeditor::import
{

// Wrapper minimo sobre stb_image/stb_image_write (third_party/stb) -- so o
// necessario para o pipeline de import ler/escrever PNG RGBA.
struct PngImage
{
	int width = 0;
	int height = 0;
	std::vector<uint8_t> pixels; // width * height * 4 (RGBA)

	uint32_t colorAt(int x, int y) const
	{
		const size_t offset = (static_cast<size_t>(y) * width + x) * 4;
		return (pixels[offset] << 24) | (pixels[offset + 1] << 16) | (pixels[offset + 2] << 8) | pixels[offset + 3];
	}
};

PngImage loadPng(const std::string& path);
void writePng(const std::string& path, int width, int height, const std::vector<uint8_t>& rgbaPixels);

} // namespace mvp::mapeditor::import
