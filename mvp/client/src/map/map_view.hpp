#pragma once

#include "mvp/engine/sprite_atlas.hpp"
#include "mvp/engine/sprite_batch.hpp"
#include "mvp/shared/map_data.hpp"

namespace mvp::client::map
{

// Desenha o mapa carregado (terreno + overlay) usando a mesma projeção
// isométrica de mvp::shared::projectCellOffset. Para o M3 (sem rede ainda)
// consome o MapData completo direto do disco; a versão que consome
// MapChunk do protocolo chega no M4/M5.
class MapView
{
public:
	MapView(shared::map::MapData mapData, engine::SpriteAtlas terrainAtlas);

	void draw(engine::SpriteBatch& spriteBatch, const engine::Shader& shader, int viewportWidth,
	          int viewportHeight);

private:
	shared::map::MapData mapData;
	engine::SpriteAtlas terrainAtlas;
};

} // namespace mvp::client::map
