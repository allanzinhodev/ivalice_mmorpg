#include "mvp/shared/iso_projection.hpp"

namespace mvp::shared
{

ScreenPoint projectCellOffset(int du, int dv)
{
	return ScreenPoint{(du - dv) * TILE_HALF_W, (du + dv) * TILE_HALF_H};
}

bool isCellVisible(int du, int dv)
{
	const ScreenPoint center = projectCellOffset(du, dv);
	const bool insideX = center.x + TILE_HALF_W >= -VIEW_W / 2 && center.x - TILE_HALF_W <= VIEW_W / 2;
	const bool insideY = center.y + TILE_HALF_H >= -VIEW_H / 2 && center.y - TILE_HALF_H <= VIEW_H / 2;
	return insideX && insideY;
}

const std::vector<CellOffset>& visibleCellOffsets()
{
	static const std::vector<CellOffset> offsets = [] {
		std::vector<CellOffset> result;
		// Cota superior segura de candidatos -- maior que qualquer célula que
		// possa realmente ser visível no viewport 480x320; o filtro geométrico
		// abaixo reduz isso ao conjunto exato.
		for (int du = -15; du <= 15; ++du) {
			for (int dv = -20; dv <= 20; ++dv) {
				if (isCellVisible(du, dv)) {
					result.push_back(CellOffset{du, dv});
				}
			}
		}
		return result;
	}();
	return offsets;
}

} // namespace mvp::shared
