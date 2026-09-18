#include "tile_dedup.hpp"

#include <stdexcept>

namespace mvp::mapeditor::import
{

TilesetImportResult importAizenfieldTileset(const std::string& terrainPngPath, const std::string& overlayPngPath)
{
	// Quantização RGBA -> paleta global de 256 índices, recorte 16x16 e dedup
	// por hash de conteúdo chegam na fase M1 (ver plano, seção "Pipeline de
	// import" / "Tileset (Aizenfield)"). Este stub existe só para o M0
	// compilar e linkar a interface completa; ele não lê os PNGs ainda.
	(void)terrainPngPath;
	(void)overlayPngPath;
	throw std::logic_error("importAizenfieldTileset: pendente de implementação (fase M1)");
}

} // namespace mvp::mapeditor::import
