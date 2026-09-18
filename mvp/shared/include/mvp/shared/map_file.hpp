#pragma once

#include <string>

#include "mvp/shared/map_data.hpp"

namespace mvp::shared::map
{

// Carrega o .mvpmap gerado pelo mapeditor. Formato: signature(u32) +
// width(u16) + height(u16), seguido de width*height células (ver
// mvp/mapeditor/src/map_editor/mvpmap_writer.cpp para o writer).
MapData loadMapFile(const std::string& path);

} // namespace mvp::shared::map
