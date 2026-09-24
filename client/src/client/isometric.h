#ifndef CLIENT_ISOMETRIC_H
#define CLIENT_ISOMETRIC_H

// 2:1 isometric projection. A grid cell is a diamond s wide and s/2 tall
// (s = sprite size, 32 by default). One Tibia floor is s/2 pixels in Y, which
// falls out of the (-1,-1) coveredUp shift for free.
//
// Pure functions only (no globals), so tests/isometric_test.cpp can build them alone.

#include <framework/util/point.h>
#include "const.h"
#include <cmath>
#include <cstdlib>

namespace Iso
{
// grid delta -> screen delta of the diamond bounding box top-left
inline Point delta(int dx, int dy, int s)
{
    return Point((dx - dy) * s / 2, (dx + dy) * s / 4);
}

// offset expressed in grid pixels (s per tile, as the walk code counts) -> screen pixels
inline Point fromGridPx(const Point& g)
{
    return Point((g.x - g.y) / 2, (g.x + g.y) / 4);
}

// diamond mask: is p (relative to cell (0,0) bbox top-left) inside the diamond of cell?
inline bool insideDiamond(const Point& p, const Point& cell, int s)
{
    const float hw = s / 2.f, hh = s / 4.f;
    const Point c = delta(cell.x, cell.y, s);
    return std::abs(p.x - (c.x + hw)) / hw + std::abs(p.y - (c.y + hh)) / hh <= 1.f;
}

// screen point (relative to cell (0,0) bbox top-left) -> grid cell.
// Coarse cell from the inverse projection, then the diamond mask picks the right
// one among the 4 candidates around the point (handles edges and negative coords).
inline Point screenToCell(const Point& p, int s)
{
    const float hw = s / 2.f, hh = s / 4.f;
    const float u = (p.x - hw) / hw, v = (p.y - hh) / hh;
    const Point coarse((int)std::floor((u + v) / 2.f), (int)std::floor((v - u) / 2.f));
    for (int dy = 0; dy <= 1; ++dy)
        for (int dx = 0; dx <= 1; ++dx)
            if (insideDiamond(p, coarse + Point(dx, dy), s))
                return coarse + Point(dx, dy);
    return coarse;
}

// 8-way direction of a screen-space vector (y grows down); used to pick missile sprites
inline Otc::Direction screenDirection(const Point& d)
{
    if (d.x == 0 && d.y == 0)
        return Otc::InvalidDirection;
    static const Otc::Direction octants[8] = { Otc::East, Otc::SouthEast, Otc::South, Otc::SouthWest,
                                               Otc::West, Otc::NorthWest, Otc::North, Otc::NorthEast };
    const float angle = std::atan2((float)d.y, (float)d.x); // -pi..pi, 0 = east, +y = south
    int octant = (int)std::lround(angle / (3.14159265f / 4.f));
    return octants[(octant + 8) % 8];
}
}

#endif
