#include <iostream>

#include "../src/import/tile_dedup.hpp"

// CLI headless do importador -- roda os mesmos passos de import/preview sem
// abrir janela, para uso em CI/scripts (ver plano, seção Bibliotecas: evita
// trazer ImGui só para o preview).
int main(int argc, char** argv)
{
	if (argc < 3) {
		std::cerr << "uso: mvp-import-cli <aizenfield.png> <aizenfield2.png>\n";
		return 1;
	}

	try {
		const auto result = mvp::mapeditor::import::importAizenfieldTileset(argv[1], argv[2]);
		std::cout << "tiles únicos: " << result.tiles.size() << '\n';
	} catch (const std::exception& error) {
		std::cerr << "mvp-import-cli: " << error.what() << '\n';
		return 1;
	}
	return 0;
}
