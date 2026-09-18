add_library(mvp_mapeditor_import STATIC
	src/import/png_image.cpp
	src/import/height_map.cpp
	src/import/tile_dedup.cpp
	src/import/outfit_import.cpp
	src/import/frame_group_preview.cpp
	src/import/dat_writer.cpp
	src/map_editor/mvpmap_writer.cpp
)
target_include_directories(mvp_mapeditor_import PUBLIC src)
target_include_directories(mvp_mapeditor_import PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../third_party/stb)
target_link_libraries(mvp_mapeditor_import PUBLIC mvp_shared mvp_engine)
target_compile_features(mvp_mapeditor_import PUBLIC cxx_std_20)

add_executable(mvp_mapeditor src/main.cpp)
target_link_libraries(mvp_mapeditor PRIVATE mvp_shared mvp_engine)
target_compile_features(mvp_mapeditor PRIVATE cxx_std_20)

add_executable(mvp_import_cli tools_cli/mvp-import-cli.cpp)
target_link_libraries(mvp_import_cli PRIVATE mvp_mapeditor_import)
target_compile_features(mvp_import_cli PRIVATE cxx_std_20)
