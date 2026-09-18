#pragma once

#include <cstdint>
#include <vector>

namespace mvp::server::map
{

// Uma célula do .mvpmap: 2 peças de terreno (esquerda/direita), overlays
// opcionais, e a elevação real usada para decidir, em runtime no client, se
// um overlay é desenhado acima ou abaixo do personagem.
struct Cell
{
	uint16_t tileLeftId = 0;
	uint16_t tileRightId = 0;
	std::vector<uint16_t> overlayIds;
	uint8_t elevation = 0;
};

struct MapData
{
	uint16_t width = 0;
	uint16_t height = 0;
	std::vector<Cell> cells; // width * height, row-major

	const Cell& at(int col, int row) const { return cells[static_cast<size_t>(row) * width + col]; }
};

} // namespace mvp::server::map
