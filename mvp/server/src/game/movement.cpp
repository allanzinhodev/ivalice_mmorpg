#include "movement.hpp"

namespace mvp::server::game
{

using shared::protocol::Direction;

namespace
{

shared::Position offsetFor(Direction direction)
{
	switch (direction) {
		case Direction::North:
			return shared::Position{0, -1};
		case Direction::NorthEast:
			return shared::Position{1, -1};
		case Direction::East:
			return shared::Position{1, 0};
		case Direction::SouthEast:
			return shared::Position{1, 1};
		case Direction::South:
			return shared::Position{0, 1};
		case Direction::SouthWest:
			return shared::Position{-1, 1};
		case Direction::West:
			return shared::Position{-1, 0};
		case Direction::NorthWest:
			return shared::Position{-1, -1};
	}
	return shared::Position{};
}

} // namespace

shared::Position applyMove(const shared::map::MapData& map, const shared::Position& current, Direction direction)
{
	const shared::Position delta = offsetFor(direction);
	const shared::Position target{current.col + delta.col, current.row + delta.row};

	if (target.col < 0 || target.row < 0 || target.col >= map.width || target.row >= map.height) {
		return current;
	}
	return target;
}

} // namespace mvp::server::game
