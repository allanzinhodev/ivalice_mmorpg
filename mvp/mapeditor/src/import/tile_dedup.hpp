#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "mvp/shared/dat_format.hpp"
#include "palette_builder.hpp"

namespace mvp::mapeditor::import
{

// Índice reservado para "peça vazia" (100% transparente).
constexpr uint16_t EMPTY_TILE_INDEX = 0xFFFF;

// Geometria do recorte por célula, idêntica à validada em
// tools/asset-compiler/extract-map-tiles.js (99.2% de fidelidade contra a
// referência). Cada célula da grade real do mapa (altura incluída) é
// recortada como um bloco CELL_W x CELL_H, que este importador fatia em
// peças PIECE_SIZE x PIECE_SIZE reutilizáveis para o .dat/.spr.
constexpr int PIECE_SIZE = 16;
constexpr int CELL_W = 32;                       // largura do recorte por célula (SPRITE)
constexpr int CELL_H = 48;                       // altura do recorte, inclui face lateral (SPRITE_H)
constexpr int PIECE_COLS_PER_CELL = CELL_W / PIECE_SIZE; // 2
constexpr int PIECE_ROWS_PER_CELL = CELL_H / PIECE_SIZE; // 3
constexpr int TILE_HALF_W = 16;
constexpr int TILE_HALF_H = 8;
constexpr int PX_PER_HEIGHT = TILE_HALF_H; // 1 unidade de altura do FFTA = 8px na tela

struct Point
{
	int x = 0;
	int y = 0;
};

// Projeção isométrica de uma célula (col,row,height) para o canto
// superior-esquerdo do recorte CELL_W x CELL_H na imagem, dada a origem já
// calibrada. Mesma fórmula de tools/asset-compiler/extract-map-tiles.js.
// Exposta para o preview reconstruir a cena na mesma posição do import.
Point projectCellTopLeft(int col, int row, int height, const Point& origin);

// Uma célula da grade real do mapa: as PIECE_COLS_PER_CELL x PIECE_ROWS_PER_CELL
// peças que compõem o recorte 32x48, e a elevação (altura - minHeight) usada
// tanto pelo .mvpmap quanto para decidir empilhamento/JUMP no futuro.
struct MapCellPieces
{
	uint16_t pieceIds[PIECE_ROWS_PER_CELL][PIECE_COLS_PER_CELL]; // linha x coluna, EMPTY_TILE_INDEX se vazio
	uint8_t elevation = 0;
};

struct TilesetImportResult
{
	std::vector<shared::dat::TileRecord> tiles; // peças 16x16 únicas pós-dedup (índice = id)
	std::vector<uint8_t> tilePixels;             // tiles.size() * TILE_PIXELS, indexed

	// grid[row][col], dimensão widthCells x heightCells -- a grade REAL do
	// mapa (16x13 no Aizenfield), não um recorte cartesiano da imagem.
	std::vector<std::vector<MapCellPieces>> terrainGrid;
	std::vector<std::vector<MapCellPieces>> overlayGrid;

	uint16_t widthCells = 0;
	uint16_t heightCells = 0;

	Point origin;          // origem calculada por calibrate(), para depuração/preview
	int sourceImageWidth = 0;  // tamanho da imagem original (terrainPng) -- canvas do preview usa este, não o
	int sourceImageHeight = 0; // bounding box das projeções, para casar exatamente com o gabarito
	size_t rawPieceCount = 0;  // total de peças 16x16 antes da dedup, para relatório
};

// Lê o height map já extraído (assets/ffta/maps/heightmaps.json, mapa 150),
// calibra a origem da projeção isométrica pelo bounding box do conteúdo de
// terrainPng, recorta cada célula como bloco 32x48 (mesma fórmula de
// tools/asset-compiler/extract-map-tiles.js: project() + calibrate()),
// fatia cada recorte em peças 16x16, deduplica por hash de conteúdo já
// quantizado, e monta a grade de referências para o .mvpmap. Ver
// mvp/docs/formats/dat-spr-v1.md, seção "Pipeline de import".
//
// `paletteBuilder` é compartilhado com o import de outfits (mesma paleta
// global de 256 cores para todo o .spr) -- o chamador (CLI) decide a ordem;
// tileset entra primeiro por convenção, mas a classe não impõe isso.
TilesetImportResult importAizenfieldTileset(const std::string& terrainPngPath, const std::string& overlayPngPath,
                                             const std::string& heightMapJsonPath, int mapIndex,
                                             PaletteBuilder& paletteBuilder);

} // namespace mvp::mapeditor::import
