#pragma once

#include <boost/asio.hpp>

#include "../game/world.hpp"

namespace mvp::server::net
{

// Decodifica as mensagens do cliente (Hello/Move) e envia as respostas
// (Spawn/MapChunk/CreatureMove) numa única conexão TCP. Sem framing extra --
// opcode de 1 byte já basta para distinguir as duas mensagens do cliente.
class ProtocolHandler
{
public:
	ProtocolHandler(boost::asio::ip::tcp::socket socket, game::World& world);

	void run();

private:
	void handleHello();
	void handleMove();
	void sendSpawn();
	void sendMapChunk();

	boost::asio::ip::tcp::socket socket;
	game::World& world;
};

} // namespace mvp::server::net
