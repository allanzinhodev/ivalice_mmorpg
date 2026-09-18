#pragma once

#include <vector>

#include "mvp/shared/map_data.hpp"
#include "mvp/shared/position.hpp"
#include "mvp/shared/protocol_messages.hpp"

namespace mvp::server::game
{

// Usa a lista pré-computada de offsets visíveis (mvp::shared::visibleCellOffsets,
// ver iso_projection.hpp) para montar o MapChunk exato a enviar a partir da
// posição do personagem -- nunca um retângulo ingênuo maior que o necessário.
std::vector<shared::protocol::CellData> computeVisibleCells(const shared::map::MapData& map,
                                                              const shared::Position& center);

} // namespace mvp::server::game
