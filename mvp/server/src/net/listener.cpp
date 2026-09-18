#include "listener.hpp"

#include "protocol_handler.hpp"

namespace mvp::server::net
{

using boost::asio::ip::tcp;

Listener::Listener(boost::asio::io_context& ioContext, uint16_t port, game::World& world)
    : acceptor(ioContext, tcp::endpoint(tcp::v4(), port)), world(world)
{}

void Listener::run()
{
	while (true) {
		tcp::socket socket = acceptor.accept();
		ProtocolHandler handler(std::move(socket), world);
		handler.run();
	}
}

} // namespace mvp::server::net
