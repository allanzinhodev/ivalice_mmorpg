#include <cstdio>
#include <iostream>
#include <string>

#include "../src/import/dat_writer.hpp"
#include "../src/import/frame_group_preview.hpp"
#include "../src/import/outfit_import.hpp"
#include "../src/import/palette_builder.hpp"
#include "../src/import/png_image.hpp"
#include "../src/import/tile_dedup.hpp"
#include "../src/map_editor/mvpmap_writer.hpp"

// CLI headless do importador -- roda os mesmos passos de import/preview sem
// abrir janela, para uso em CI/scripts (ver plano, seção Bibliotecas: evita
// trazer ImGui só para o preview).
//
// uso: mvp-import-cli all <aizenfield.png> <aizenfield2.png> <aizenfield3.png>
//                          <heightmaps.json> <mapIndex> <outfits_export_dir>
//                          <out_dir> [--commit]
//
// Sem --commit: só gera o preview do tileset e o relatório de comparação
// contra o gabarito (aizenfield3.png) -- nada é gravado no .dat/.spr/.mvpmap
// final, conforme a regra "o parse final só deve ser feito após eu
// confirmar".
namespace
{

using mvp::mapeditor::import::loadPng;
using mvp::mapeditor::import::PngImage;

double compareAgainstReference(const PngImage& preview, const PngImage& reference)
{
	if (preview.width != reference.width || preview.height != reference.height) {
		std::cerr << "aviso: preview (" << preview.width << "x" << preview.height << ") e referencia ("
		          << reference.width << "x" << reference.height << ") tem dimensoes diferentes\n";
		return 0.0;
	}

	size_t matching = 0;
	const size_t totalPixels = static_cast<size_t>(preview.width) * preview.height;
	for (size_t i = 0; i < totalPixels; ++i) {
		const size_t offset = i * 4;
		const bool referenceTransparent = reference.pixels[offset + 3] == 0;
		const bool previewTransparent = preview.pixels[offset + 3] == 0;
		if (referenceTransparent && previewTransparent) {
			++matching;
			continue;
		}
		if (referenceTransparent != previewTransparent) {
			continue;
		}
		if (preview.pixels[offset + 0] == reference.pixels[offset + 0] &&
		    preview.pixels[offset + 1] == reference.pixels[offset + 1] &&
		    preview.pixels[offset + 2] == reference.pixels[offset + 2]) {
			++matching;
		}
	}
	return 100.0 * static_cast<double>(matching) / static_cast<double>(totalPixels);
}

int runAllImport(int argc, char** argv)
{
	if (argc < 9) {
		std::cerr << "uso: mvp-import-cli all <aizenfield.png> <aizenfield2.png> <aizenfield3.png> "
		             "<heightmaps.json> <mapIndex> <outfits_export_dir> <out_dir> [--commit]\n";
		return 1;
	}

	const std::string terrainPath = argv[2];
	const std::string overlayPath = argv[3];
	const std::string referencePath = argv[4];
	const std::string heightMapPath = argv[5];
	const int mapIndex = std::stoi(argv[6]);
	const std::string outfitsExportDir = argv[7];
	const std::string outDir = argv[8];
	const bool commit = argc >= 10 && std::string(argv[9]) == "--commit";

	mvp::mapeditor::import::PaletteBuilder paletteBuilder;

	std::cout << "importando tileset...\n";
	const auto tileset =
	    mvp::mapeditor::import::importAizenfieldTileset(terrainPath, overlayPath, heightMapPath, mapIndex,
	                                                       paletteBuilder);

	std::cout << "importando outfits (" << outfitsExportDir << ")...\n";
	const auto outfits = mvp::mapeditor::import::importFftaOutfitsExport(outfitsExportDir, paletteBuilder);
	std::printf("outfits importadas: %zu, frames unicos: %zu\n", outfits.creatures.size(),
	            outfits.framePixels.size() / mvp::shared::dat::CREATURE_PIXELS);

	// A paleta só fecha depois de tileset E outfits terem sido processados
	// (é compartilhada) -- por isso os previews (que precisam da paleta
	// final) rodam depois dos dois imports, não intercalados com eles.
	const auto palette = paletteBuilder.build();
	const uint8_t colorKeyIndex = paletteBuilder.colorKeyIndex();

	const std::string tilesetPreviewPath = outDir + "/tileset_preview.png";
	mvp::mapeditor::import::writeTilesetPreview(tileset, palette, colorKeyIndex, tilesetPreviewPath);

	const PngImage preview = loadPng(tilesetPreviewPath);
	const PngImage reference = loadPng(referencePath);
	const double matchPercent = compareAgainstReference(preview, reference);
	std::printf("comparacao contra gabarito (%s): %.2f%% dos pixels identicos\n", referencePath.c_str(),
	            matchPercent);

	const std::string outfitPreviewPath = outDir + "/outfit_preview.png";
	mvp::mapeditor::import::writeOutfitPreview(outfits, palette, colorKeyIndex, outfitPreviewPath);

	if (!commit) {
		std::cout << "preview gerado, --commit nao passado -- nada foi gravado.\n";
		return 0;
	}

	const std::string datPath = outDir + "/mvp.dat";
	const std::string sprPath = outDir + "/mvp.spr";
	mvp::mapeditor::import::writeDatAndSpr(tileset, outfits, palette, datPath, sprPath);

	const std::string mvpMapPath = outDir + "/aizenfield.mvpmap";
	mvp::mapeditor::map_editor::writeMvpMap(tileset, mvpMapPath);

	std::cout << "gravado: " << datPath << ", " << sprPath << ", " << mvpMapPath << '\n';
	return 0;
}

} // namespace

int main(int argc, char** argv)
{
	if (argc < 2) {
		std::cerr << "uso: mvp-import-cli <all> ...\n";
		return 1;
	}

	try {
		const std::string command = argv[1];
		if (command == "all") {
			return runAllImport(argc, argv);
		}
		std::cerr << "comando desconhecido: " << command << '\n';
		return 1;
	} catch (const std::exception& error) {
		std::cerr << "mvp-import-cli: " << error.what() << '\n';
		return 1;
	}
}
