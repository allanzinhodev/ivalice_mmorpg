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
	explicit World(shared::map::MapData mapData)
	    : mapData(std::move(mapData)),
	      creature{1, shared::Position{this->mapData.width / 2, this->mapData.height / 2},
	                shared::protocol::Direction::South, 1}
	{}

	const shared::map::MapData& map() const { return mapData; }

	Creature& testCreature() { return creature; }
	const Creature& testCreature() const { return creature; }

private:
	shared::map::MapData mapData;
	Creature creature;
};

} // namespace mvp::server::game
