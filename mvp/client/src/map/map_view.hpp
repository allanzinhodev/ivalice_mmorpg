#pragma once

#include "mvp/engine/sprite_atlas.hpp"
#include "mvp/engine/sprite_batch.hpp"
#include "mvp/shared/dat_format.hpp"
#include "mvp/shared/map_data.hpp"

namespace mvp::client::map
{

// Desenha o mapa carregado (terreno + overlay) usando a mesma projeção
// isométrica de mvp::shared::projectCellOffset, mais um outfit de teste
// fixo no centro (M2/M3, sem rede/movimento ainda -- isso chega no M4/M5).
//
// Simplificação conhecida desta fase: como terreno e outfit vêm de atlas
// (texturas) diferentes, o desenho roda em 3 passadas -- todo o terreno,
// depois o personagem, depois todo o overlay -- em vez de intercalar por
// célula. A oclusão fica levemente incorreta perto da célula do
// personagem (overlay sempre por cima); resolver isso corretamente (troca
// de textura/flush por camada no SpriteBatch) só se justifica quando
// houver múltiplas criaturas/itens de verdade (M4/M5+).
class MapView
{
public:
	MapView(shared::map::MapData mapData, engine::SpriteAtlas terrainAtlas, engine::SpriteAtlas creatureAtlas,
	        const shared::dat::CreatureRecord* testCreature);

	void draw(engine::SpriteBatch& terrainBatch, const engine::Shader& terrainShader,
	          engine::SpriteBatch& creatureBatch, const engine::Shader& creatureShader, int viewportWidth,
	          int viewportHeight);

private:
	shared::map::MapData mapData;
	engine::SpriteAtlas terrainAtlas;
	engine::SpriteAtlas creatureAtlas;
	const shared::dat::CreatureRecord* testCreature;
};

} // namespace mvp::client::map
