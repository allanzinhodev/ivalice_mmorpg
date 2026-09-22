#include <boost/asio.hpp>
#include <iostream>

#include "mvp/shared/byte_stream.hpp"
#include "mvp/shared/protocol_messages.hpp"

// Cliente de teste headless: valida o fluxo Hello -> Spawn -> MapChunk ->
// Move -> CreatureMove -> MapChunk contra um mvp_server real, sem depender
// de input de teclado (SendKeys/PostMessage não alcançam a janela OpenGL
// do client de forma confiável -- ver skill vcpkg).
using boost::asio::ip::tcp;

namespace
{

uint16_t readU16(tcp::socket& socket)
{
	uint8_t bytes[2];
	boost::asio::read(socket, boost::asio::buffer(bytes, 2));
	return static_cast<uint16_t>(bytes[0]) | (static_cast<uint16_t>(bytes[1]) << 8);
}

uint32_t readU32(tcp::socket& socket)
{
	uint8_t bytes[4];
	boost::asio::read(socket, boost::asio::buffer(bytes, 4));
	uint32_t value = 0;
	for (int i = 0; i < 4; ++i) {
		value |= static_cast<uint32_t>(bytes[i]) << (8 * i);
	}
	return value;
}

uint8_t readU8(tcp::socket& socket)
{
	uint8_t byte = 0;
	boost::asio::read(socket, boost::asio::buffer(&byte, 1));
	return byte;
}

void skipMapChunk(tcp::socket& socket)
{
	const uint8_t opcode = readU8(socket);
	if (opcode != static_cast<uint8_t>(mvp::shared::protocol::ServerOpcode::MapChunk)) {
		throw std::runtime_error("esperava MapChunk");
	}
	const uint16_t cellCount = readU16(socket);
	for (uint16_t i = 0; i < cellCount; ++i) {
		readU16(socket); // du
		readU16(socket); // dv
		for (int j = 0; j < mvp::shared::protocol::CELL_PIECE_ROWS * mvp::shared::protocol::CELL_PIECE_COLS * 2;
		     ++j) {
			readU16(socket);
		}
		readU8(socket); // elevation
	}
	std::cout << "MapChunk recebido: " << cellCount << " celulas\n";
}

} // namespace

int main()
{
	try {
		boost::asio::io_context ioContext;
		tcp::socket socket(ioContext);
		tcp::resolver resolver(ioContext);
		boost::asio::connect(socket, resolver.resolve("127.0.0.1", "7100"));

		// Hello
		const uint8_t helloOpcode = static_cast<uint8_t>(mvp::shared::protocol::ClientOpcode::Hello);
		boost::asio::write(socket, boost::asio::buffer(&helloOpcode, 1));

		// Spawn
		const uint8_t spawnOpcode = readU8(socket);
		if (spawnOpcode != static_cast<uint8_t>(mvp::shared::protocol::ServerOpcode::Spawn)) {
			throw std::runtime_error("esperava Spawn");
		}
		const uint32_t creatureId = readU32(socket);
		const uint16_t col = readU16(socket);
		const uint16_t row = readU16(socket);
		const uint8_t outfitId = readU8(socket);
		std::cout << "Spawn: creature " << creatureId << " em (" << col << "," << row << ") outfit " << outfitId
		          << '\n';

		skipMapChunk(socket);

		// Move (South) -- ver mvp::server::game::offsetFor: South = (0,+1)
		const uint8_t movePayload[2] = {static_cast<uint8_t>(mvp::shared::protocol::ClientOpcode::Move),
		                                 static_cast<uint8_t>(mvp::shared::protocol::Direction::South)};
		boost::asio::write(socket, boost::asio::buffer(movePayload, 2));

		const uint8_t moveOpcode = readU8(socket);
		if (moveOpcode != static_cast<uint8_t>(mvp::shared::protocol::ServerOpcode::CreatureMove)) {
			throw std::runtime_error("esperava CreatureMove");
		}
		const uint32_t movedCreatureId = readU32(socket);
		const uint16_t newCol = readU16(socket);
		const uint16_t newRow = readU16(socket);
		const uint8_t facing = readU8(socket);
		std::cout << "CreatureMove: creature " << movedCreatureId << " agora em (" << newCol << "," << newRow
		          << ") facing " << static_cast<int>(facing) << '\n';

		if (newRow != row + 1 || newCol != col) {
			std::cerr << "FALHA: esperava mover de (" << col << "," << row << ") para (" << col << "," << row + 1
			           << "), mas moveu para (" << newCol << "," << newRow << ")\n";
			return 1;
		}

		skipMapChunk(socket);

		std::cout << "OK: movimento validado (South: row " << row << " -> " << newRow << ")\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << "mvp-network-test: " << error.what() << '\n';
		return 1;
	}
}
