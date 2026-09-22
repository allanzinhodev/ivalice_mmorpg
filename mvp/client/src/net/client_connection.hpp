#pragma once

#include <boost/asio.hpp>
#include <functional>
#include <string>

#include "mvp/shared/protocol_messages.hpp"

namespace mvp::client::net
{

// Conexão TCP simples com o server do MVP: envia Hello/Move, recebe
// Spawn/MapChunk/CreatureMove/CreatureLeave. Leitura bloqueante e
// sequencial -- o cliente só faz uma coisa por vez (sem thread de rede
// separada), suficiente para o critério de aceite do MVP (mover e ver o
// mapa, não um jogo de tempo real com muitos eventos simultâneos).
class ClientConnection
{
public:
	ClientConnection();

	void connect(const std::string& host, uint16_t port);
	void sendHello();
	void sendMove(shared::protocol::Direction direction);
	void disconnect();

	// Bloqueia até a próxima mensagem do server chegar e despacha para o
	// callback correspondente. Usado no fluxo síncrono de handshake
	// (Hello -> Spawn -> MapChunk) e após cada Move.
	void receiveSpawn(shared::protocol::SpawnMessage& outMessage);
	void receiveMapChunk(shared::protocol::MapChunkMessage& outMessage);
	void receiveCreatureMove(shared::protocol::CreatureMoveMessage& outMessage);

private:
	uint8_t readOpcode();

	boost::asio::io_context ioContext;
	boost::asio::ip::tcp::socket socket;
};

} // namespace mvp::client::net
