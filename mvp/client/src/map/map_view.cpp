#include "map_view.hpp"

#include "mvp/engine/outfit_render.hpp"
#include "mvp/shared/iso_projection.hpp"

namespace mvp::client::map
{

using shared::map::EMPTY_PIECE_INDEX;
using shared::map::PIECE_COLS_PER_CELL;
using shared::map::PIECE_ROWS_PER_CELL;

namespace
{

constexpr int PIECE_SIZE = 16;
constexpr int CELL_W = 32;
constexpr int FRAME_W = 32;
constexpr int FRAME_H = 48;

void pushCellPieces(engine::SpriteBatch& spriteBatch, const engine::SpriteAtlas& atlas,
                     const std::array<std::array<uint16_t, PIECE_COLS_PER_CELL>, PIECE_ROWS_PER_CELL>& pieceIds,
                     int cellScreenX, int cellScreenY)
{
	for (int pieceRow = 0; pieceRow < PIECE_ROWS_PER_CELL; ++pieceRow) {
		for (int pieceCol = 0; pieceCol < PIECE_COLS_PER_CELL; ++pieceCol) {
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

MapView::MapView(shared::map::MapData mapData, engine::SpriteAtlas terrainAtlas, engine::SpriteAtlas creatureAtlas,
                  const shared::dat::CreatureRecord* testCreature)
    : mapData(std::move(mapData)),
      terrainAtlas(std::move(terrainAtlas)),
      creatureAtlas(std::move(creatureAtlas)),
      testCreature(testCreature)
{}

void MapView::draw(engine::SpriteBatch& terrainBatch, const engine::Shader& terrainShader,
                    engine::SpriteBatch& creatureBatch, const engine::Shader& creatureShader, int viewportWidth,
                    int viewportHeight)
{
	const int centerCol = mapData.width / 2;
	const int centerRow = mapData.height / 2;
	const int originX = viewportWidth / 2;
	const int originY = viewportHeight / 2;

	auto cellScreenPos = [&](int col, int row, uint8_t elevation) {
		const shared::ScreenPoint offset = shared::projectCellOffset(col - centerCol, row - centerRow);
		return shared::ScreenPoint{originX + offset.x - CELL_W / 2,
		                            originY + offset.y - shared::TILE_HALF_H - elevation * shared::TILE_HALF_H};
	};

	// Passada 1: terreno inteiro (trás para frente, row+col crescente --
	// mesma convenção do pipeline de import).
	terrainBatch.begin();
	for (int row = 0; row < mapData.height; ++row) {
		for (int col = 0; col < mapData.width; ++col) {
			const shared::map::Cell& cell = mapData.at(col, row);
			const shared::ScreenPoint pos = cellScreenPos(col, row, cell.elevation);
			pushCellPieces(terrainBatch, terrainAtlas, cell.terrainPieceIds, pos.x, pos.y);
		}
	}
	terrainBatch.end(terrainShader);

	// Passada 2: personagem de teste, fixo na célula central.
	if (testCreature != nullptr && !testCreature->frameGroups.empty() &&
	    !testCreature->frameGroups[0].phases.empty()) {
		const shared::map::Cell& centerCell = mapData.at(centerCol, centerRow);
		const shared::ScreenPoint pos = cellScreenPos(centerCol, centerRow, centerCell.elevation);

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

	// Passada 3: overlay inteiro (por cima do personagem -- simplificação
	// conhecida desta fase, ver comentário no header).
	terrainBatch.begin();
	for (int row = 0; row < mapData.height; ++row) {
		for (int col = 0; col < mapData.width; ++col) {
			const shared::map::Cell& cell = mapData.at(col, row);
			const shared::ScreenPoint pos = cellScreenPos(col, row, cell.elevation);
			pushCellPieces(terrainBatch, terrainAtlas, cell.overlayPieceIds, pos.x, pos.y);
		}
	}
	terrainBatch.end(terrainShader);
}

} // namespace mvp::client::map
