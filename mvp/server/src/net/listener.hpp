#pragma once

#include <boost/asio.hpp>

#include "../game/world.hpp"

namespace mvp::server::net
{

// Aceita conexões TCP; cada conexão vira um ProtocolHandler síncrono próprio
// -- sem pool de threads nem sessões concorrentes no MVP (um personagem de
// teste, sem necessidade de escalar ainda).
class Listener
{
public:
	Listener(boost::asio::io_context& ioContext, uint16_t port, game::World& world);

	void run();

private:
	boost::asio::ip::tcp::acceptor acceptor;
	game::World& world;
};

} // namespace mvp::server::net
