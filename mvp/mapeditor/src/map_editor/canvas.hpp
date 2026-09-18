#pragma once

#include "mvp/engine/sprite_batch.hpp"

namespace mvp::mapeditor::map_editor
{

// Desenha o mapa em edição reaproveitando o mesmo SpriteBatch/iso_projection
// do client (ver decisão do plano: mapeditor reaproveita o motor do
// client, não duplica renderização). UI interativa (pintar células) fica
// para depois do MVP -- ver nota sobre ImGui no plano.
class Canvas
{
public:
	explicit Canvas(mvp::engine::SpriteBatch& spriteBatch) : spriteBatch(spriteBatch) {}

private:
	mvp::engine::SpriteBatch& spriteBatch;
};

} // namespace mvp::mapeditor::map_editor
