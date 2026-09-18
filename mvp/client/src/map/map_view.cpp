#include "map_view.hpp"

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
			const engine::AtlasRegion& region = atlas.tileRegion(pieceId);

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

MapView::MapView(shared::map::MapData mapData, engine::SpriteAtlas terrainAtlas)
    : mapData(std::move(mapData)), terrainAtlas(std::move(terrainAtlas))
{}

void MapView::draw(engine::SpriteBatch& spriteBatch, const engine::Shader& shader, int viewportWidth,
                    int viewportHeight)
{
	spriteBatch.begin();

	// Câmera fixa no centro da grade para o M3 (sem personagem/rede ainda).
	const int centerCol = mapData.width / 2;
	const int centerRow = mapData.height / 2;
	const int originX = viewportWidth / 2;
	const int originY = viewportHeight / 2;

	// Desenha em ordem de trás para frente (row+col crescente) -- mesma
	// convenção do pipeline de import: a face lateral de uma célula alta
	// deve sobrepor o terreno da célula vizinha mais próxima da câmera.
	for (int row = 0; row < mapData.height; ++row) {
		for (int col = 0; col < mapData.width; ++col) {
			const shared::map::Cell& cell = mapData.at(col, row);

			// offset é o CENTRO do losango de topo da célula (32x16); o bloco
			// recortado (32x48) tem esse losango nas suas linhas 0-15, então
			// o canto superior-esquerdo do bloco fica 16px à esquerda e 8px
			// acima do centro -- e a elevação sobe o bloco na tela (mesma
			// convenção do pipeline de import: altura maior = Y menor).
			const shared::ScreenPoint offset = shared::projectCellOffset(col - centerCol, row - centerRow);
			const int cellScreenX = originX + offset.x - CELL_W / 2;
			const int cellScreenY = originY + offset.y - shared::TILE_HALF_H - cell.elevation * shared::TILE_HALF_H;

			pushCellPieces(spriteBatch, terrainAtlas, cell.terrainPieceIds, cellScreenX, cellScreenY);
			pushCellPieces(spriteBatch, terrainAtlas, cell.overlayPieceIds, cellScreenX, cellScreenY);
		}
	}

	spriteBatch.end(shader);
}

} // namespace mvp::client::map
