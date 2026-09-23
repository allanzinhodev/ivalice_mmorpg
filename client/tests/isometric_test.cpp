// Self-check for client/src/client/isometric.h.
// Build: cl /std:c++20 /EHsc /I client/src client/tests/isometric_test.cpp  (or g++ -std=c++20 -Iclient/src)
#include <client/isometric.h>
#include <cassert>
#include <cstdio>

int main()
{
    const int s = 32;

    // round trip: diamond center of every cell maps back to that cell (all 4 quadrants)
    for (int y = -6; y <= 6; ++y)
        for (int x = -6; x <= 6; ++x) {
            const Point center = Iso::delta(x, y, s) + Point(s / 2, s / 4);
            assert(Iso::screenToCell(center, s) == Point(x, y));
        }

    // every pixel of a wide area lands in a cell whose diamond contains it
    for (int py = -200; py <= 200; ++py)
        for (int px = -200; px <= 200; ++px) {
            const Point p(px, py);
            assert(Iso::insideDiamond(p, Iso::screenToCell(p, s), s));
        }

    // just inside / just outside the edges of cell (0,0): vertices at (16,0),(32,8),(16,16),(0,8)
    assert(Iso::screenToCell(Point(16, 1), s) == Point(0, 0));   // below top vertex
    assert(Iso::screenToCell(Point(16, -1), s) == Point(-1, -1)); // above top vertex -> cell up
    assert(Iso::screenToCell(Point(31, 8), s) == Point(0, 0));
    assert(Iso::screenToCell(Point(33, 8), s) == Point(1, -1));   // right vertex -> NE neighbour
    assert(Iso::screenToCell(Point(16, 15), s) == Point(0, 0));
    assert(Iso::screenToCell(Point(16, 17), s) == Point(1, 1));   // below bottom vertex
    assert(Iso::screenToCell(Point(1, 8), s) == Point(0, 0));
    assert(Iso::screenToCell(Point(-1, 8), s) == Point(-1, 1));   // left vertex -> SW neighbour

    // one floor up (-1,-1) is exactly s/2 pixels up
    assert(Iso::delta(-1, -1, s) == Point(0, -s / 2));

    // walk offsets in grid pixels
    assert(Iso::fromGridPx(Point(32, 0)) == Iso::delta(1, 0, s));
    assert(Iso::fromGridPx(Point(0, -32)) == Iso::delta(0, -1, s));

    // missile octants in screen space
    assert(Iso::screenDirection(Iso::delta(1, 0, s)) == Otc::SouthEast); // grid east goes down-right
    assert(Iso::screenDirection(Iso::delta(0, -1, s)) == Otc::NorthEast);
    assert(Iso::screenDirection(Iso::delta(1, 1, s)) == Otc::South);
    assert(Iso::screenDirection(Iso::delta(1, -1, s)) == Otc::East);
    assert(Iso::screenDirection(Iso::delta(-1, -1, s)) == Otc::North);
    assert(Iso::screenDirection(Iso::delta(-1, 1, s)) == Otc::West);
    assert(Iso::screenDirection(Point(0, 0)) == Otc::InvalidDirection);

    std::puts("isometric_test: ok");
    return 0;
}
