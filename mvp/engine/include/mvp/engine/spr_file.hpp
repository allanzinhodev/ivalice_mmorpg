#pragma once

#include <string>

#include "mvp/shared/dat_format.hpp"

namespace mvp::engine
{

// Parser do .spr novo (paleta indexed compartilhada). Implementação chega
// junto com dat_file.hpp nas fases M1/M2.
shared::dat::SprFile loadSprFile(const std::string& path);

} // namespace mvp::engine
