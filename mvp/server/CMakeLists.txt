find_package(Boost REQUIRED COMPONENTS system)

add_executable(mvp_server
	src/main.cpp
	src/map/map_file.cpp
	src/game/movement.cpp
	src/game/visibility.cpp
	src/net/listener.cpp
	src/net/protocol_handler.cpp
)

target_include_directories(mvp_server PRIVATE src)
target_link_libraries(mvp_server PRIVATE mvp_shared Boost::system)
target_compile_features(mvp_server PRIVATE cxx_std_20)
