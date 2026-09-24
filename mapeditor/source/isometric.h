//////////////////////////////////////////////////////////////////////
// Isometric (2:1) view for validating the ivalice client projection.
// Same math as client/src/client/isometric.h: a tile is a diamond
// TileSize wide and TileSize/2 tall; one floor lifts TileSize/2.
//
// The editor keeps computing its usual orthogonal "draw space" coordinates
// (scroll, zoom and floor offsets included) and this linear map rotates them
// around a pivot (the screen center), so scrolling/goto/centering still work.
//////////////////////////////////////////////////////////////////////

#ifndef RME_ISOMETRIC_H_
#define RME_ISOMETRIC_H_

#include <cmath>

namespace Iso {

// orthogonal point -> isometric point (a square's top-left corner becomes the diamond's top vertex)
inline void projectVertex(float& x, float& y, float pivot_x, float pivot_y) {
	const float gx = x - pivot_x, gy = y - pivot_y;
	x = pivot_x + (gx - gy) / 2.0f;
	y = pivot_y + (gx + gy) / 4.0f;
}

// orthogonal tile draw point -> sprite draw point (top-left of the diamond's bounding box)
inline void projectTile(int& x, int& y, float pivot_x, float pivot_y, int tile_size) {
	float fx = static_cast<float>(x), fy = static_cast<float>(y);
	projectVertex(fx, fy, pivot_x, pivot_y);
	x = static_cast<int>(std::floor(fx)) - tile_size / 2;
	y = static_cast<int>(std::floor(fy));
}

// isometric point -> orthogonal point. The square [o, o + TileSize) maps exactly onto its
// diamond, so dividing the result by TileSize is a pixel-exact diamond hit-test.
inline void unprojectVertex(float& x, float& y, float pivot_x, float pivot_y) {
	const float sx = x - pivot_x, sy = y - pivot_y;
	x = pivot_x + sx + 2.0f * sy;
	y = pivot_y + 2.0f * sy - sx;
}

}

#endif
