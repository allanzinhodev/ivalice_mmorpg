#pragma once

#include <string>

#include "mvp/shared/dat_format.hpp"

namespace mvp::engine
{

// Parser do .dat novo (mvp/shared/dat_format.hpp). Implementação chega na
// fase M1 (import de tileset) e M2 (import de outfit/creatures).
shared::dat::DatFile loadDatFile(const std::string& path);

} // namespace mvp::engine
