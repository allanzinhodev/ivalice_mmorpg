#include <cstdio>
#include <iostream>
#include <string>

#include "../src/import/dat_writer.hpp"
#include "../src/import/frame_group_preview.hpp"
#include "../src/import/png_image.hpp"
#include "../src/import/tile_dedup.hpp"
#include "../src/map_editor/mvpmap_writer.hpp"

// CLI headless do importador -- roda os mesmos passos de import/preview sem
// abrir janela, para uso em CI/scripts (ver plano, seção Bibliotecas: evita
// trazer ImGui só para o preview).
//
// uso: mvp-import-cli tileset <aizenfield.png> <aizenfield2.png> <aizenfield3.png>
//                              <heightmaps.json> <mapIndex> <out_dir> [--commit]
//
// Sem --commit: só gera o preview e o relatório de comparação contra o
// gabarito (aizenfield3.png) -- nada é gravado no .dat/.spr/.mvpmap final,
// conforme a regra "o parse final só deve ser feito após eu confirmar".
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

int runTilesetImport(int argc, char** argv)
{
	if (argc < 8) {
		std::cerr << "uso: mvp-import-cli tileset <aizenfield.png> <aizenfield2.png> <aizenfield3.png> "
		             "<heightmaps.json> <mapIndex> <out_dir> [--commit]\n";
		return 1;
	}

	const std::string terrainPath = argv[2];
	const std::string overlayPath = argv[3];
	const std::string referencePath = argv[4];
	const std::string heightMapPath = argv[5];
	const int mapIndex = std::stoi(argv[6]);
	const std::string outDir = argv[7];
	const bool commit = argc >= 9 && std::string(argv[8]) == "--commit";

	const auto result = mvp::mapeditor::import::importAizenfieldTileset(terrainPath, overlayPath, heightMapPath,
	                                                                      mapIndex);

	const std::string previewPath = outDir + "/tileset_preview.png";
	mvp::mapeditor::import::writeTilesetPreview(result, previewPath);

	const PngImage preview = loadPng(previewPath);
	const PngImage reference = loadPng(referencePath);
	const double matchPercent = compareAgainstReference(preview, reference);
	std::printf("comparacao contra gabarito (%s): %.2f%% dos pixels identicos\n", referencePath.c_str(),
	            matchPercent);

	if (!commit) {
		std::cout << "preview gerado, --commit nao passado -- nada foi gravado.\n";
		return 0;
	}

	mvp::mapeditor::import::OutfitImportResult emptyOutfit; // outfits chegam no M2
	const std::string datPath = outDir + "/mvp.dat";
	const std::string sprPath = outDir + "/mvp.spr";
	mvp::mapeditor::import::writeDatAndSpr(result, emptyOutfit, datPath, sprPath);

	const std::string mvpMapPath = outDir + "/aizenfield.mvpmap";
	mvp::mapeditor::map_editor::writeMvpMap(result, mvpMapPath);

	std::cout << "gravado: " << datPath << ", " << sprPath << ", " << mvpMapPath << '\n';
	return 0;
}

} // namespace

int main(int argc, char** argv)
{
	if (argc < 2) {
		std::cerr << "uso: mvp-import-cli <tileset> ...\n";
		return 1;
	}

	try {
		const std::string command = argv[1];
		if (command == "tileset") {
			return runTilesetImport(argc, argv);
		}
		std::cerr << "comando desconhecido: " << command << '\n';
		return 1;
	} catch (const std::exception& error) {
		std::cerr << "mvp-import-cli: " << error.what() << '\n';
		return 1;
	}
}
