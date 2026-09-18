#pragma once

#include <cstdint>

#include "mvp/shared/position.hpp"
#include "mvp/shared/protocol_messages.hpp"

namespace mvp::server::game
{

// Sem conta/persistência no MVP -- um personagem de teste fixo, criado no
// Hello e reaproveitado enquanto o processo do server estiver rodando.
struct Creature
{
	uint32_t id = 0;
	shared::Position position;
	shared::protocol::Direction facing = shared::protocol::Direction::South;
	uint8_t outfitId = 0;
};

} // namespace mvp::server::game
