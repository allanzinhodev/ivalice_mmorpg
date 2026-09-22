#include "map_view.hpp"

#include <algorithm>

#include "mvp/engine/outfit_render.hpp"
#include "mvp/shared/iso_projection.hpp"

namespace mvp::client::map
{

using shared::protocol::CELL_PIECE_COLS;
using shared::protocol::CELL_PIECE_ROWS;

namespace
{

constexpr int PIECE_SIZE = 16;
constexpr int CELL_W = 32;
constexpr int FRAME_W = 32;
constexpr int FRAME_H = 48;
constexpr uint16_t EMPTY_PIECE_INDEX = 0xFFFF;

void pushCellPieces(engine::SpriteBatch& spriteBatch, const engine::SpriteAtlas& atlas,
                     const std::array<std::array<uint16_t, CELL_PIECE_COLS>, CELL_PIECE_ROWS>& pieceIds,
                     int cellScreenX, int cellScreenY)
{
	for (int pieceRow = 0; pieceRow < CELL_PIECE_ROWS; ++pieceRow) {
		for (int pieceCol = 0; pieceCol < CELL_PIECE_COLS; ++pieceCol) {
			const uint16_t pieceId = pieceIds[pieceRow][pieceCol];
			if (pieceId == EMPTY_PIECE_INDEX) {
				continue;
			}
			const engine::AtlasRegion& region = atlas.region(pieceId);

			engine::SpriteQuad quad;
			quad.x = cellScreenX + pieceCol * PIECE_SIZE;
			quad.y = cellScreenY + pieceRow * PIECE_SIZE;
			quad.width = PIECE_SIZE;
			quad.height = PIECE_SIZE;
			quad.u0 = region.u0;
			quad.v0 = region.v0;
			quad.u1 = region.u1;
			quad.v1 = region.v1;
			spriteBatch.push(quad);
		}
	}
}

} // namespace

MapView::MapView(engine::SpriteAtlas terrainAtlas, engine::SpriteAtlas creatureAtlas,
                  const shared::dat::CreatureRecord* testCreature)
    : terrainAtlas(std::move(terrainAtlas)), creatureAtlas(std::move(creatureAtlas)), testCreature(testCreature)
{}

void MapView::draw(engine::SpriteBatch& terrainBatch, const engine::Shader& terrainShader,
                    engine::SpriteBatch& creatureBatch, const engine::Shader& creatureShader, int viewportWidth,
                    int viewportHeight)
{
	const int originX = viewportWidth / 2;
	const int originY = viewportHeight / 2;

	auto cellScreenPos = [&](int du, int dv, uint8_t elevation) {
		const shared::ScreenPoint offset = shared::projectCellOffset(du, dv);
		return shared::ScreenPoint{originX + offset.x - CELL_W / 2,
		                            originY + offset.y - shared::TILE_HALF_H - elevation * shared::TILE_HALF_H};
	};

	// Passada 1: terreno das células visíveis (já vêm do server em ordem
	// de trás para frente -- ver game::computeVisibleCells/visibleCellOffsets).
	terrainBatch.begin();
	for (const auto& cell : cells) {
		const shared::ScreenPoint pos = cellScreenPos(cell.du, cell.dv, cell.elevation);
		pushCellPieces(terrainBatch, terrainAtlas, cell.terrainPieceIds, pos.x, pos.y);
	}
	terrainBatch.end(terrainShader);

	// Passada 2: personagem do jogador, sempre no offset (0,0) -- o server
	// centra o MapChunk na posição dele (ver visibleCellOffsets).
	if (testCreature != nullptr && !testCreature->frameGroups.empty() &&
	    !testCreature->frameGroups[0].phases.empty()) {
		const auto centerIt = std::find_if(cells.begin(), cells.end(),
		                                    [](const shared::protocol::CellData& c) { return c.du == 0 && c.dv == 0; });
		const uint8_t centerElevation = centerIt != cells.end() ? centerIt->elevation : 0;
		const shared::ScreenPoint pos = cellScreenPos(0, 0, centerElevation);

		const engine::OutfitDrawInfo info =
		    engine::resolveOutfitSprite(testCreature->frameGroups[0], 0, engine::RenderDirection::South, false);
		const engine::AtlasRegion& region = creatureAtlas.region(info.spriteIndex);

		creatureBatch.begin();
		engine::SpriteQuad quad;
		// Âncora: pés no centro da célula (mesma convenção da skill
		// isometrico) -- o frame 32x48 tem os pés na última linha.
		quad.x = pos.x;
		quad.y = pos.y - (FRAME_H - shared::TILE_HALF_H * 2);
		quad.width = FRAME_W;
		quad.height = FRAME_H;
		quad.u0 = region.u0;
		quad.v0 = region.v0;
		quad.u1 = region.u1;
		quad.v1 = region.v1;
		quad.flipHorizontal = info.flipHorizontal;
		creatureBatch.push(quad);
		creatureBatch.end(creatureShader);
	}

	// Passada 3: overlay das células visíveis (por cima do personagem --
	// simplificação conhecida desta fase, ver comentário no header).
	terrainBatch.begin();
	for (const auto& cell : cells) {
		const shared::ScreenPoint pos = cellScreenPos(cell.du, cell.dv, cell.elevation);
		pushCellPieces(terrainBatch, terrainAtlas, cell.overlayPieceIds, pos.x, pos.y);
	}
	terrainBatch.end(terrainShader);
}

} // namespace mvp::client::map
