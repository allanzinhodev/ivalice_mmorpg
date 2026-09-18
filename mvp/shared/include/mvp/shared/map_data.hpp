#pragma once

#include <array>
#include <cstdint>
#include <vector>

namespace mvp::shared::map
{

// Geometria de recorte por célula (ver mapeditor/src/import/tile_dedup.hpp):
// cada célula do mapa é composta por PIECE_COLS x PIECE_ROWS peças de 16x16
// (2x3 = 6), recortadas de um bloco 32x48 que inclui a face lateral de
// elevação.
constexpr int PIECE_COLS_PER_CELL = 2;
constexpr int PIECE_ROWS_PER_CELL = 3;
constexpr uint16_t EMPTY_PIECE_INDEX = 0xFFFF;

// Uma célula do .mvpmap: as peças de terreno e de overlay que compõem o
// recorte 32x48, e a elevação real usada para decidir, em runtime no
// client, se um overlay é desenhado acima ou abaixo do personagem.
struct Cell
{
	std::array<std::array<uint16_t, PIECE_COLS_PER_CELL>, PIECE_ROWS_PER_CELL> terrainPieceIds{};
	std::array<std::array<uint16_t, PIECE_COLS_PER_CELL>, PIECE_ROWS_PER_CELL> overlayPieceIds{};
	uint8_t elevation = 0;
};

struct MapData
{
	uint16_t width = 0;
	uint16_t height = 0;
	std::vector<Cell> cells; // width * height, row-major

	const Cell& at(int col, int row) const { return cells[static_cast<size_t>(row) * width + col]; }
};

} // namespace mvp::shared::map
