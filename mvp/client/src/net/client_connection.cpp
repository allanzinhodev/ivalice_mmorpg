#include "client_connection.hpp"

#include <stdexcept>

namespace mvp::client::net
{

using boost::asio::ip::tcp;
using shared::protocol::CellData;
using shared::protocol::CreatureMoveMessage;
using shared::protocol::Direction;
using shared::protocol::MapChunkMessage;
using shared::protocol::ServerOpcode;
using shared::protocol::SpawnMessage;

namespace
{

uint16_t readU16(boost::asio::ip::tcp::socket& socket)
{
	uint8_t bytes[2];
	boost::asio::read(socket, boost::asio::buffer(bytes, 2));
	return static_cast<uint16_t>(bytes[0]) | (static_cast<uint16_t>(bytes[1]) << 8);
}

uint32_t readU32(boost::asio::ip::tcp::socket& socket)
{
	uint8_t bytes[4];
	boost::asio::read(socket, boost::asio::buffer(bytes, 4));
	uint32_t value = 0;
	for (int i = 0; i < 4; ++i) {
		value |= static_cast<uint32_t>(bytes[i]) << (8 * i);
	}
	return value;
}

uint8_t readU8Socket(boost::asio::ip::tcp::socket& socket)
{
	uint8_t byte = 0;
	boost::asio::read(socket, boost::asio::buffer(&byte, 1));
	return byte;
}

} // namespace

ClientConnection::ClientConnection() : socket(ioContext) {}

void ClientConnection::connect(const std::string& host, uint16_t port)
{
	tcp::resolver resolver(ioContext);
	const auto endpoints = resolver.resolve(host, std::to_string(port));
	boost::asio::connect(socket, endpoints);
}

void ClientConnection::sendHello()
{
	const uint8_t opcode = static_cast<uint8_t>(shared::protocol::ClientOpcode::Hello);
	boost::asio::write(socket, boost::asio::buffer(&opcode, sizeof(opcode)));
}

void ClientConnection::sendMove(shared::protocol::Direction direction)
{
	const uint8_t payload[2] = {
	    static_cast<uint8_t>(shared::protocol::ClientOpcode::Move),
	    static_cast<uint8_t>(direction),
	};
	boost::asio::write(socket, boost::asio::buffer(payload, sizeof(payload)));
}

void ClientConnection::disconnect()
{
	boost::system::error_code ignored;
	socket.close(ignored);
}

uint8_t ClientConnection::readOpcode()
{
	return readU8Socket(socket);
}

void ClientConnection::receiveSpawn(SpawnMessage& outMessage)
{
	const uint8_t opcode = readOpcode();
	if (opcode != static_cast<uint8_t>(ServerOpcode::Spawn)) {
		throw std::runtime_error("ClientConnection: esperava Spawn, recebeu outro opcode");
	}
	outMessage.creatureId = readU32(socket);
	outMessage.position.col = readU16(socket);
	outMessage.position.row = readU16(socket);
	outMessage.outfitId = readU8Socket(socket);
}

void ClientConnection::receiveMapChunk(MapChunkMessage& outMessage)
{
	const uint8_t opcode = readOpcode();
	if (opcode != static_cast<uint8_t>(ServerOpcode::MapChunk)) {
		throw std::runtime_error("ClientConnection: esperava MapChunk, recebeu outro opcode");
	}
	const uint16_t cellCount = readU16(socket);
	outMessage.cells.clear();
	outMessage.cells.reserve(cellCount);
	for (uint16_t i = 0; i < cellCount; ++i) {
		CellData cell;
		cell.du = static_cast<int16_t>(readU16(socket));
		cell.dv = static_cast<int16_t>(readU16(socket));
		for (auto& row : cell.terrainPieceIds) {
			for (auto& pieceId : row) {
				pieceId = readU16(socket);
			}
		}
		for (auto& row : cell.overlayPieceIds) {
			for (auto& pieceId : row) {
				pieceId = readU16(socket);
			}
		}
		cell.elevation = readU8Socket(socket);
		outMessage.cells.push_back(cell);
	}
}

void ClientConnection::receiveCreatureMove(CreatureMoveMessage& outMessage)
{
	const uint8_t opcode = readOpcode();
	if (opcode != static_cast<uint8_t>(ServerOpcode::CreatureMove)) {
		throw std::runtime_error("ClientConnection: esperava CreatureMove, recebeu outro opcode");
	}
	outMessage.creatureId = readU32(socket);
	outMessage.position.col = readU16(socket);
	outMessage.position.row = readU16(socket);
	outMessage.direction = static_cast<Direction>(readU8Socket(socket));
}

} // namespace mvp::client::net
