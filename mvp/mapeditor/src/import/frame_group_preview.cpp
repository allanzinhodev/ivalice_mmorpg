#include "frame_group_preview.hpp"

#include <stdexcept>

namespace mvp::mapeditor::import
{

void writeTilesetPreview(const TilesetImportResult& result, const std::string& outputPngPath)
{
	(void)result;
	(void)outputPngPath;
	throw std::logic_error("writeTilesetPreview: pendente de implementação (fase M1)");
}

void writeOutfitPreview(const OutfitImportResult& result, const std::string& outputPngPath)
{
	(void)result;
	(void)outputPngPath;
	throw std::logic_error("writeOutfitPreview: pendente de implementação (fase M2)");
}

} // namespace mvp::mapeditor::import
