#pragma once

#include <array>
#include <cstdint>
#include <vector>

#include "mvp/shared/position.hpp"

// Protocolo de rede novo e simplificado do MVP. Sem TLS, sem negociação de
// conta/feature -- opcode de 1 byte + payload de tamanho fixo por opcode.
// Ver mvp/docs/formats/protocol-v1.md para a descrição completa.
namespace mvp::shared::protocol
{

enum class ClientOpcode : uint8_t
{
	Hello = 0x01,
	Move = 0x02,
};

enum class ServerOpcode : uint8_t
{
	Spawn = 0x81,
	MapChunk = 0x82,
	CreatureMove = 0x83,
	CreatureLeave = 0x84,
};

enum class Direction : uint8_t
{
	North = 0,
	NorthEast = 1,
	East = 2,
	SouthEast = 3,
	South = 4,
	SouthWest = 5,
	West = 6,
	NorthWest = 7,
};

struct MoveMessage
{
	Direction direction = Direction::South;
};

struct SpawnMessage
{
	uint32_t creatureId = 0;
	Position position;
	uint8_t outfitId = 0;
};

// Geometria de recorte por célula: 2 colunas x 3 linhas de peças 16x16 (ver
// mapeditor/src/import/tile_dedup.hpp). 0xFFFF = peça vazia/transparente.
constexpr int CELL_PIECE_COLS = 2;
constexpr int CELL_PIECE_ROWS = 3;

struct CellData
{
	int16_t du = 0;
	int16_t dv = 0;
	std::array<std::array<uint16_t, CELL_PIECE_COLS>, CELL_PIECE_ROWS> terrainPieceIds{};
	std::array<std::array<uint16_t, CELL_PIECE_COLS>, CELL_PIECE_ROWS> overlayPieceIds{};
	uint8_t elevation = 0;
};

struct MapChunkMessage
{
	std::vector<CellData> cells;
};

struct CreatureMoveMessage
{
	uint32_t creatureId = 0;
	Position position;
	Direction direction = Direction::South;
};

struct CreatureLeaveMessage
{
	uint32_t creatureId = 0;
};

} // namespace mvp::shared::protocol
