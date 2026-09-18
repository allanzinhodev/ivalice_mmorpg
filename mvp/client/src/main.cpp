#include <GL/glew.h>

#include <iostream>

#include "mvp/shared/iso_projection.hpp"
#include "window.hpp"

int main()
{
	try {
		mvp::client::Window window(mvp::shared::VIEW_W, mvp::shared::VIEW_H, "ivalice mvp client");

		window.run([]() {
			glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
			glClear(GL_COLOR_BUFFER_BIT);
		});
	} catch (const std::exception& error) {
		std::cerr << "mvp client: " << error.what() << '\n';
		return 1;
	}
	return 0;
}
