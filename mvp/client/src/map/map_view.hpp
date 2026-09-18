#pragma once

#include <cstdint>
#include <vector>

#include "mvp/shared/position.hpp"
#include "mvp/shared/protocol_messages.hpp"

namespace mvp::client::map
{

// Monta a cena visível a partir do estado replicado do server (MapChunk +
// posição do personagem). Composição/desenho real via SpriteBatch chega na
// fase M3; por ora guarda o estado mínimo.
class MapView
{
public:
	void setCells(const std::vector<shared::protocol::CellData>& cells) { cells_ = cells; }
	void setCharacterPosition(const shared::Position& position) { characterPosition_ = position; }

	const std::vector<shared::protocol::CellData>& cells() const { return cells_; }
	const shared::Position& characterPosition() const { return characterPosition_; }

private:
	std::vector<shared::protocol::CellData> cells_;
	shared::Position characterPosition_;
};

} // namespace mvp::client::map
