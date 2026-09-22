#pragma once

#include "mvp/engine/sprite_atlas.hpp"
#include "mvp/engine/sprite_batch.hpp"
#include "mvp/shared/dat_format.hpp"
#include "mvp/shared/protocol_messages.hpp"

namespace mvp::client::map
{

// Desenha o mapa a partir do estado replicado do server (MapChunk, com
// células relativas à câmera -- du/dv), mais o personagem do jogador na
// posição recebida em Spawn/CreatureMove.
//
// Simplificação conhecida desta fase: como terreno e outfit vêm de atlas
// (texturas) diferentes, o desenho roda em 3 passadas -- todo o terreno,
// depois o personagem, depois todo o overlay -- em vez de intercalar por
// célula. A oclusão fica levemente incorreta perto da célula do
// personagem (overlay sempre por cima); resolver isso corretamente (troca
// de textura/flush por camada no SpriteBatch) só se justifica quando
// houver múltiplas criaturas/itens de verdade.
class MapView
{
public:
	MapView(engine::SpriteAtlas terrainAtlas, engine::SpriteAtlas creatureAtlas,
	        const shared::dat::CreatureRecord* testCreature);

	void setMapChunk(const shared::protocol::MapChunkMessage& chunk) { cells = chunk.cells; }

	void draw(engine::SpriteBatch& terrainBatch, const engine::Shader& terrainShader,
	          engine::SpriteBatch& creatureBatch, const engine::Shader& creatureShader, int viewportWidth,
	          int viewportHeight);

private:
	std::vector<shared::protocol::CellData> cells;
	engine::SpriteAtlas terrainAtlas;
	engine::SpriteAtlas creatureAtlas;
	const shared::dat::CreatureRecord* testCreature;
};

} // namespace mvp::client::map
