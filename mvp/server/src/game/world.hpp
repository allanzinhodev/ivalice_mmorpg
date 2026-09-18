#pragma once

#include <cstdint>

#include "creature.hpp"
#include "mvp/shared/map_data.hpp"

namespace mvp::server::game
{

// Estado do mundo em memória: o mapa carregado e o único personagem de teste
// do MVP (sem login/persistência -- ver decisão 5 do plano).
class World
{
public:
	explicit World(shared::map::MapData mapData) : mapData(std::move(mapData)) {}

	const shared::map::MapData& map() const { return mapData; }

	Creature& testCreature() { return creature; }
	const Creature& testCreature() const { return creature; }

private:
	shared::map::MapData mapData;
	Creature creature{1, shared::Position{0, 0}, shared::protocol::Direction::South, 1};
};

} // namespace mvp::server::game
