find_package(Boost REQUIRED COMPONENTS system)

add_executable(mvp_server
	src/main.cpp
	src/game/movement.cpp
	src/game/visibility.cpp
	src/net/listener.cpp
	src/net/protocol_handler.cpp
)

target_include_directories(mvp_server PRIVATE src)
target_link_libraries(mvp_server PRIVATE mvp_shared Boost::system)
target_compile_features(mvp_server PRIVATE cxx_std_20)

add_custom_command(TARGET mvp_server POST_BUILD
	COMMAND ${CMAKE_COMMAND} -E copy_directory
		${CMAKE_CURRENT_SOURCE_DIR}/data $<TARGET_FILE_DIR:mvp_server>/data
)

add_executable(mvp_network_test tools_test/mvp-network-test.cpp)
target_link_libraries(mvp_network_test PRIVATE mvp_shared Boost::system)
target_compile_features(mvp_network_test PRIVATE cxx_std_20)
