#pragma once

#include <cstdint>

#include "../map/map_data.hpp"
#include "creature.hpp"

namespace mvp::server::game
{

// Estado do mundo em memória: o mapa carregado e o único personagem de teste
// do MVP (sem login/persistência -- ver decisão 5 do plano).
class World
{
public:
	explicit World(map::MapData mapData) : mapData(std::move(mapData)) {}

	const map::MapData& map() const { return mapData; }

	Creature& testCreature() { return creature; }
	const Creature& testCreature() const { return creature; }

private:
	map::MapData mapData;
	Creature creature{1, shared::Position{0, 0}, shared::protocol::Direction::South, 1};
};

} // namespace mvp::server::game
