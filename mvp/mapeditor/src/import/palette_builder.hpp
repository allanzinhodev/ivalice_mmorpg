#pragma once

#include <array>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <vector>

#include "mvp/shared/dat_format.hpp"

namespace mvp::mapeditor::import
{

// Paleta global compartilhada entre tiles e outfits: uma entrada por cor
// RGB distinta (índice 0 reservado para o colorkey/transparência). Sem
// quantização de perda -- se ultrapassar 255 cores reais entre todas as
// fontes, falha explicitamente em vez de degradar a arte silenciosamente
// (ver mvp/docs/formats/dat-spr-v1.md, risco de paleta compartilhada).
class PaletteBuilder
{
public:
	uint8_t colorKeyIndex() const { return 0; }

	uint8_t indexFor(uint8_t r, uint8_t g, uint8_t b, bool transparent)
	{
		if (transparent) {
			return colorKeyIndex();
		}
		const uint32_t key = (static_cast<uint32_t>(r) << 16) | (static_cast<uint32_t>(g) << 8) | b;
		auto it = colorToIndex.find(key);
		if (it != colorToIndex.end()) {
			return it->second;
		}
		if (entries.size() >= 255) {
			throw std::runtime_error("PaletteBuilder: mais de 255 cores distintas entre tiles e outfits -- "
			                          "quantização não implementada");
		}
		const uint8_t index = static_cast<uint8_t>(entries.size() + 1);
		colorToIndex.emplace(key, index);
		entries.push_back(shared::dat::PaletteEntry{r, g, b});
		return index;
	}

	std::array<shared::dat::PaletteEntry, 256> build() const
	{
		std::array<shared::dat::PaletteEntry, 256> palette{};
		palette[0] = shared::dat::PaletteEntry{255, 0, 255};
		for (size_t i = 0; i < entries.size(); ++i) {
			palette[i + 1] = entries[i];
		}
		return palette;
	}

private:
	std::map<uint32_t, uint8_t> colorToIndex;
	std::vector<shared::dat::PaletteEntry> entries;
};

} // namespace mvp::mapeditor::import
