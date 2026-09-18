#include <GL/glew.h>

#include <iostream>

int main()
{
	// Janela/loop reaproveitando mvp::client::Window e mvp::engine::SpriteBatch
	// chega quando o Canvas (map_editor/canvas.hpp) tiver o que desenhar de
	// verdade -- fase M1/M3. Por ora o mapeditor GUI só confirma que a lib de
	// import e o engine linkam corretamente; o fluxo real de import roda via
	// mvp-import-cli (tools_cli/) enquanto a UI não existe.
	std::cout << "mvp mapeditor: use mvp-import-cli para rodar o pipeline de import.\n";
	return 0;
}
