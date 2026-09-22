#include <GL/glew.h>

#include <algorithm>
#include <array>
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

		constexpr int TILE_PIECE_SIZE = 16;
		constexpr int CREATURE_FRAME_W = 32;
		constexpr int CREATURE_FRAME_H = 48;

		std::array<mvp::shared::dat::PaletteEntry, 256> palette{};
		std::copy_n(sprFile.palette.begin(), std::min<size_t>(sprFile.palette.size(), 256), palette.begin());

		mvp::engine::SpriteAtlas terrainAtlas(sprFile.tilePixels, TILE_PIECE_SIZE, TILE_PIECE_SIZE,
		                                       sprFile.header.tileSpriteCount, palette, 0);
		mvp::engine::SpriteAtlas creatureAtlas(sprFile.creaturePixels, CREATURE_FRAME_W, CREATURE_FRAME_H,
		                                        sprFile.header.creatureSpriteCount, palette, 0);

		auto terrainTexture = terrainAtlas.texture();
		auto creatureTexture = creatureAtlas.texture();

		const mvp::shared::dat::CreatureRecord* testCreature =
		    datFile.creatures.empty() ? nullptr : &datFile.creatures[0];

		mvp::client::map::MapView mapView(std::move(mapData), std::move(terrainAtlas), std::move(creatureAtlas),
		                                    testCreature);

		mvp::engine::Shader shader(mvp::engine::shaders::SPRITE_VERTEX, mvp::engine::shaders::SPRITE_FRAGMENT);

		float projection[16];
		mvp::engine::orthographicProjection(mvp::shared::VIEW_W, mvp::shared::VIEW_H, projection);
		shader.use();
		shader.setUniformMat4("uProjection", projection);

		mvp::engine::SpriteBatch terrainBatch(terrainTexture);
		mvp::engine::SpriteBatch creatureBatch(creatureTexture);

		window.run([&]() {
			glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
			glClear(GL_COLOR_BUFFER_BIT);
			mapView.draw(terrainBatch, shader, creatureBatch, shader, mvp::shared::VIEW_W, mvp::shared::VIEW_H);
		});
	} catch (const std::exception& error) {
		std::cerr << "mvp client: " << error.what() << '\n';
		return 1;
	}
	return 0;
}
