#include "outfit_import.hpp"

#include <stdexcept>

namespace mvp::mapeditor::import
{

OutfitImportResult importFftaOutfitSpritesheet(const std::string& spritesheetPath)
{
	// Recorte/realinhamento/classificação em frame group chegam na fase M2
	// (ver plano, seção "Pipeline de import" / "Outfit (spritesheet FFTA2)").
	(void)spritesheetPath;
	throw std::logic_error("importFftaOutfitSpritesheet: pendente de implementação (fase M2)");
}

} // namespace mvp::mapeditor::import
