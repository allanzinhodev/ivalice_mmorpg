find_package(GLEW REQUIRED)
find_package(OpenGL REQUIRED)

add_library(mvp_engine STATIC
	src/dat_file.cpp
	src/spr_file.cpp
	src/palette.cpp
	src/outfit_render.cpp
	src/gl_context.cpp
	src/sprite_batch.cpp
)

target_include_directories(mvp_engine PUBLIC include)
target_link_libraries(mvp_engine PUBLIC mvp_shared GLEW::GLEW OpenGL::GL)
target_compile_features(mvp_engine PUBLIC cxx_std_20)
