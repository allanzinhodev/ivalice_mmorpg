#include "visibility.hpp"

#include "mvp/shared/iso_projection.hpp"

namespace mvp::server::game
{

std::vector<shared::protocol::CellData> computeVisibleCells(const map::MapData& map, const shared::Position& center)
{
	std::vector<shared::protocol::CellData> result;

	for (const shared::CellOffset& offset : shared::visibleCellOffsets()) {
		const int col = center.col + offset.du;
		const int row = center.row + offset.dv;
		if (col < 0 || row < 0 || col >= map.width || row >= map.height) {
			continue;
		}

		const map::Cell& cell = map.at(col, row);

		shared::protocol::CellData data;
		data.du = static_cast<int16_t>(offset.du);
		data.dv = static_cast<int16_t>(offset.dv);
		data.tileLeftId = cell.tileLeftId;
		data.tileRightId = cell.tileRightId;
		data.overlayIds = cell.overlayIds;
		result.push_back(std::move(data));
	}

	return result;
}

} // namespace mvp::server::game
