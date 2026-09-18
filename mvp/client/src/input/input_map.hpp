#pragma once

#include <optional>

#include "mvp/shared/protocol_messages.hpp"

namespace mvp::client::input
{

// Traduz uma tecla de seta/WASD para uma direção do protocolo. Ligação real
// ao loop de mensagens da janela Win32 chega na fase M5 (movimento).
std::optional<shared::protocol::Direction> directionFromVirtualKey(int virtualKeyCode);

} // namespace mvp::client::input
