#pragma once

#include "mvp/shared/map_data.hpp"
#include "mvp/shared/position.hpp"
#include "mvp/shared/protocol_messages.hpp"

namespace mvp::server::game
{

// M4/M5: sem itens bloqueantes ainda -- todo movimento dentro dos limites do
// mapa é permitido. Validação de elevação/JUMP (ver skill isometrico) fica
// para depois do critério de aceite do MVP.
shared::Position applyMove(const shared::map::MapData& map, const shared::Position& current,
                            shared::protocol::Direction direction);

} // namespace mvp::server::game
