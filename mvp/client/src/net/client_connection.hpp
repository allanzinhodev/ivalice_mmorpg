#pragma once

#include <boost/asio.hpp>
#include <functional>
#include <string>

#include "mvp/shared/protocol_messages.hpp"

namespace mvp::client::net
{

// Conexão TCP simples com o server do MVP. Implementação completa do fluxo
// Hello/Spawn/MapChunk/Move chega na fase M4; por ora expõe só o essencial
// para abrir/fechar o socket.
class ClientConnection
{
public:
	ClientConnection();

	void connect(const std::string& host, uint16_t port);
	void sendHello();
	void sendMove(shared::protocol::Direction direction);
	void disconnect();

private:
	boost::asio::io_context ioContext;
	boost::asio::ip::tcp::socket socket;
};

} // namespace mvp::client::net
