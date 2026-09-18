find_package(Boost REQUIRED COMPONENTS system)

add_executable(mvp_client
	src/main.cpp
	src/window.cpp
	src/net/client_connection.cpp
	src/input/input_map.cpp
)

target_include_directories(mvp_client PRIVATE src)
target_link_libraries(mvp_client PRIVATE mvp_shared mvp_engine Boost::system)
target_compile_features(mvp_client PRIVATE cxx_std_20)

if(WIN32)
	target_link_libraries(mvp_client PRIVATE opengl32)
endif()
