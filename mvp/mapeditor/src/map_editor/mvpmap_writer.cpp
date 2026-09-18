#include "mvpmap_writer.hpp"

#include <stdexcept>

namespace mvp::mapeditor::map_editor
{

void writeMvpMap(const import::TilesetImportResult& tileset, const std::string& outputPath)
{
	// Depende da grade terrainGrid/overlayGrid produzida por
	// importAizenfieldTileset, que ainda é um stub (fase M1) -- este writer
	// fica pendente junto.
	(void)tileset;
	(void)outputPath;
	throw std::logic_error("writeMvpMap: pendente de implementação (fase M1)");
}

} // namespace mvp::mapeditor::map_editor
