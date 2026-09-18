add_library(mvp_shared STATIC
	src/iso_projection.cpp
	src/map_file.cpp
)

target_include_directories(mvp_shared PUBLIC include)
target_compile_features(mvp_shared PUBLIC cxx_std_20)
