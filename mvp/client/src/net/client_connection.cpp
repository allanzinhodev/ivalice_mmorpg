#include "client_connection.hpp"

namespace mvp::client::net
{

using boost::asio::ip::tcp;

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

} // namespace mvp::client::net
