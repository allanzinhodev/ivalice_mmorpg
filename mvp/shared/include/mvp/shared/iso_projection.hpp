#pragma once

#include <vector>

namespace mvp::shared
{

// Projeção isométrica em losango 32x16, mesma família de fórmulas já
// validada no client atual (client/src/client/mapview.cpp,
// MapView::transformPositionTo2D) e documentada na skill "isometrico".
// Sem FLOOR_LIFT/z aqui -- o MVP não tem andares.
constexpr int TILE_HALF_W = 16;
constexpr int TILE_HALF_H = 8;

constexpr int VIEW_W = 480;
constexpr int VIEW_H = 320;

struct ScreenPoint
{
	int x = 0;
	int y = 0;
};

// Projeta a diferença (du, dv) entre uma célula e a câmera para um ponto de
// tela relativo ao centro do viewport.
ScreenPoint projectCellOffset(int du, int dv);

// Verdadeiro se o losango 32x16 da célula em (du, dv) relativo à câmera
// intersecta o retângulo do viewport -- substitui a estimativa ingênua de
// "40x32 células" por um teste geométrico exato.
bool isCellVisible(int du, int dv);

struct CellOffset
{
	int du = 0;
	int dv = 0;
};

// Lista pré-computada de offsets visíveis, calculada uma única vez (não
// depende da posição do jogador, só da geometria do viewport).
const std::vector<CellOffset>& visibleCellOffsets();

} // namespace mvp::shared
