#pragma once

#include <string>

#include "map_data.hpp"

namespace mvp::server::map
{

// Carrega o .mvpmap gerado pelo mapeditor (ver mvp/docs/formats/dat-spr-v1.md
// e a fase M1 do plano). Formato: MvpMapHeader (signature, width, height)
// seguido de width*height células.
MapData loadMapFile(const std::string& path);

} // namespace mvp::server::map
