#include "protocol_handler.hpp"

#include "../game/movement.hpp"
#include "../game/visibility.hpp"
#include "mvp/shared/byte_stream.hpp"

namespace mvp::server::net
{

using shared::ByteWriter;
using shared::protocol::ClientOpcode;
using shared::protocol::Direction;
using shared::protocol::ServerOpcode;

ProtocolHandler::ProtocolHandler(boost::asio::ip::tcp::socket socket, game::World& world)
    : socket(std::move(socket)), world(world)
{}

void ProtocolHandler::run()
{
	uint8_t opcode = 0;
	boost::system::error_code error;

	while (true) {
		const size_t bytesRead = boost::asio::read(socket, boost::asio::buffer(&opcode, sizeof(opcode)), error);
		if (error || bytesRead == 0) {
			return;
		}

		switch (static_cast<ClientOpcode>(opcode)) {
			case ClientOpcode::Hello:
				handleHello();
				break;
			case ClientOpcode::Move:
				handleMove();
				break;
		}
	}
}

void ProtocolHandler::handleHello()
{
	sendSpawn();
	sendMapChunk();
}

void ProtocolHandler::handleMove()
{
	uint8_t directionByte = 0;
	boost::asio::read(socket, boost::asio::buffer(&directionByte, sizeof(directionByte)));

	game::Creature& creature = world.testCreature();
	const Direction direction = static_cast<Direction>(directionByte);
	creature.position = game::applyMove(world.map(), creature.position, direction);
	creature.facing = direction;

	ByteWriter writer;
	writer.writeU8(static_cast<uint8_t>(ServerOpcode::CreatureMove));
	writer.writeU32(creature.id);
	writer.writeU16(static_cast<uint16_t>(creature.position.col));
	writer.writeU16(static_cast<uint16_t>(creature.position.row));
	writer.writeU8(static_cast<uint8_t>(creature.facing));
	boost::asio::write(socket, boost::asio::buffer(writer.data()));

	sendMapChunk();
}

void ProtocolHandler::sendSpawn()
{
	const game::Creature& creature = world.testCreature();

	ByteWriter writer;
	writer.writeU8(static_cast<uint8_t>(ServerOpcode::Spawn));
	writer.writeU32(creature.id);
	writer.writeU16(static_cast<uint16_t>(creature.position.col));
	writer.writeU16(static_cast<uint16_t>(creature.position.row));
	writer.writeU8(creature.outfitId);
	boost::asio::write(socket, boost::asio::buffer(writer.data()));
}

void ProtocolHandler::sendMapChunk()
{
	const auto cells = game::computeVisibleCells(world.map(), world.testCreature().position);

	ByteWriter writer;
	writer.writeU8(static_cast<uint8_t>(ServerOpcode::MapChunk));
	writer.writeU16(static_cast<uint16_t>(cells.size()));
	for (const auto& cell : cells) {
		writer.writeU16(static_cast<uint16_t>(cell.du));
		writer.writeU16(static_cast<uint16_t>(cell.dv));
		for (const auto& row : cell.terrainPieceIds) {
			for (uint16_t pieceId : row) {
				writer.writeU16(pieceId);
			}
		}
		for (const auto& row : cell.overlayPieceIds) {
			for (uint16_t pieceId : row) {
				writer.writeU16(pieceId);
			}
		}
		writer.writeU8(cell.elevation);
	}
	boost::asio::write(socket, boost::asio::buffer(writer.data()));
}

} // namespace mvp::server::net
