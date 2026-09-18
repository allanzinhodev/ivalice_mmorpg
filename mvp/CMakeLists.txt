cmake_minimum_required(VERSION 3.21)
project(ivalice_mvp CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(MSVC)
	add_compile_options(/W4)
else()
	add_compile_options(-Wall -Wextra)
endif()

if(WIN32)
	# boost-asio pede uma versao minima do Windows explicita; sem isso emite
	# warning em toda TU que inclui <boost/asio.hpp> (client e server).
	add_compile_definitions(_WIN32_WINNT=0x0601)
endif()

add_subdirectory(shared)
add_subdirectory(engine)
add_subdirectory(client)
add_subdirectory(server)
add_subdirectory(mapeditor)
