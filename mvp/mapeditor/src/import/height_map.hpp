#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace mvp::mapeditor::import
{

struct HeightMap
{
	std::vector<std::vector<uint8_t>> grid; // grid[row][col]
	int width = 0;
	int height = 0;
	uint8_t minHeight = 0;
};

// Lê assets/ffta/maps/heightmaps.json (gerado pelo pipeline de extração do
// FFTA) e devolve a grade de altura de um mapa específico. Parser mínimo
// escrito à mão para esta estrutura simples (array de mapas, cada um com uma
// grade retangular de inteiros) -- não traz uma lib JSON completa só para
// isso, conforme a regra de dependência mínima do projeto.
HeightMap loadHeightMap(const std::string& jsonPath, int mapIndex);

} // namespace mvp::mapeditor::import
