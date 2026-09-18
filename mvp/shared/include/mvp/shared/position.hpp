#pragma once

#include <cstdint>

namespace mvp::shared
{

struct Position
{
	int32_t col = 0;
	int32_t row = 0;

	friend bool operator==(const Position& a, const Position& b)
	{
		return a.col == b.col && a.row == b.row;
	}
};

} // namespace mvp::shared
