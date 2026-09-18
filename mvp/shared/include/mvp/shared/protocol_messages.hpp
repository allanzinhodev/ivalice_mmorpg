#pragma once

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

struct CellData
{
	int16_t du = 0;
	int16_t dv = 0;
	uint16_t tileLeftId = 0;
	uint16_t tileRightId = 0;
	std::vector<uint16_t> overlayIds;
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
