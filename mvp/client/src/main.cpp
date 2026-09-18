#include <GL/glew.h>

#include <iostream>

#include "map/map_view.hpp"
#include "mvp/engine/dat_file.hpp"
#include "mvp/engine/gl_context.hpp"
#include "mvp/engine/shaders.hpp"
#include "mvp/engine/spr_file.hpp"
#include "mvp/engine/sprite_atlas.hpp"
#include "mvp/shared/iso_projection.hpp"
#include "mvp/shared/map_file.hpp"
#include "window.hpp"

int main()
{
	try {
		mvp::client::Window window(mvp::shared::VIEW_W, mvp::shared::VIEW_H, "ivalice mvp client");

		glEnable(GL_BLEND);
		glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

		const mvp::shared::dat::DatFile datFile = mvp::engine::loadDatFile("assets_runtime/mvp.dat");
		const mvp::shared::dat::SprFile sprFile = mvp::engine::loadSprFile("assets_runtime/mvp.spr");
		mvp::shared::map::MapData mapData = mvp::shared::map::loadMapFile("assets_runtime/aizenfield.mvpmap");

		mvp::engine::SpriteAtlas terrainAtlas(sprFile, 0);
		auto atlasTexture = terrainAtlas.texture();
		mvp::client::map::MapView mapView(std::move(mapData), std::move(terrainAtlas));

		mvp::engine::Shader shader(mvp::engine::shaders::SPRITE_VERTEX, mvp::engine::shaders::SPRITE_FRAGMENT);

		float projection[16];
		mvp::engine::orthographicProjection(mvp::shared::VIEW_W, mvp::shared::VIEW_H, projection);
		shader.use();
		shader.setUniformMat4("uProjection", projection);

		mvp::engine::SpriteBatch spriteBatch(atlasTexture);

		(void)datFile; // frame groups de outfit chegam no M4/M5; .dat só confirma que carrega

		window.run([&]() {
			glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
			glClear(GL_COLOR_BUFFER_BIT);
			mapView.draw(spriteBatch, shader, mvp::shared::VIEW_W, mvp::shared::VIEW_H);
		});
	} catch (const std::exception& error) {
		std::cerr << "mvp client: " << error.what() << '\n';
		return 1;
	}
	return 0;
}
