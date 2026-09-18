#include <boost/asio.hpp>
#include <iostream>

#include "game/world.hpp"
#include "mvp/shared/map_file.hpp"
#include "net/listener.hpp"

int main()
{
	try {
		mvp::shared::map::MapData mapData = mvp::shared::map::loadMapFile("data/maps/aizenfield.mvpmap");
		mvp::server::game::World world(std::move(mapData));

		boost::asio::io_context ioContext;
		mvp::server::net::Listener listener(ioContext, 7100, world);

		std::cout << "mvp server listening on port 7100\n";
		listener.run();
	} catch (const std::exception& error) {
		std::cerr << "mvp server: " << error.what() << '\n';
		return 1;
	}
	return 0;
}
