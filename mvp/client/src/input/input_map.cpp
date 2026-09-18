#include "input_map.hpp"

#include <windows.h>

namespace mvp::client::input
{

using shared::protocol::Direction;

std::optional<Direction> directionFromVirtualKey(int virtualKeyCode)
{
	switch (virtualKeyCode) {
		case VK_UP:
			return Direction::North;
		case VK_DOWN:
			return Direction::South;
		case VK_LEFT:
			return Direction::West;
		case VK_RIGHT:
			return Direction::East;
		default:
			return std::nullopt;
	}
}

} // namespace mvp::client::input
