/*
 * Copyright (c) 2010-2017 OTClient <https://github.com/edubart/otclient>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

#include "mapview.h"

#include "creature.h"
#include "map.h"
#include "tile.h"
#include "statictext.h"
#include "animatedtext.h"
#include "missile.h"
#include "lightview.h"
#include "localplayer.h"
#include "game.h"
#include "gameconfig.h"
#include "spritemanager.h"
#include "isometric.h"

#include <framework/graphics/graphics.h>
#include <framework/graphics/image.h>
#include <framework/graphics/framebuffermanager.h>
#include <framework/core/eventdispatcher.h>
#include <framework/core/application.h>
#include <framework/core/resourcemanager.h>
#include <framework/graphics/texturemanager.h>
#include <framework/graphics/atlas.h>
#include <framework/graphics/shadermanager.h>

#include <framework/util/extras.h>
#include <framework/core/adaptiverenderer.h>

MapView::MapView()
{
    m_fadingFloorTimers.resize(g_gameConfig.getMapMaxZ() + 1);
    m_cachedVisibleTiles.resize(g_gameConfig.getMapMaxZ() + 1);
    m_lockedFirstVisibleFloor = -1;
    m_cachedFirstVisibleFloor = g_gameConfig.getMapSeaFloor();
    m_cachedLastVisibleFloor = g_gameConfig.getMapSeaFloor();
    m_minimumAmbientLight = 0;
    m_optimizedSize = Size(g_map.getAwareRange().horizontal(), g_map.getAwareRange().vertical()) * g_sprites.spriteSize();

    setVisibleDimension(Size(15, 11));
}

MapView::~MapView()
{
    VALIDATE(!g_app.isTerminated());
}

void MapView::drawTileTexts(const Rect& rect, const Rect& srcRect)
{
    Position cameraPosition = getCameraPosition();
    Point drawOffset = srcRect.topLeft();
    float horizontalStretchFactor = rect.width() / (float)srcRect.width();
    float verticalStretchFactor = rect.height() / (float)srcRect.height();

    auto player = g_game.getLocalPlayer();
    auto floor = player->getPosition().z;
    for (auto& tile : m_cachedVisibleTiles[floor]) {
        Position tilePos = tile->getPosition();
        Point p = transformPositionTo2D(tilePos, cameraPosition) - drawOffset;
        p.x *= horizontalStretchFactor;
        p.y *= verticalStretchFactor;
        p += rect.topLeft();
        p.y += 5;

        tile->drawTexts(p);
    }
}

void MapView::drawTileWidget(const Rect& rect, const Rect& srcRect)
{
    Position cameraPosition = getCameraPosition();
    Point drawOffset = srcRect.topLeft();
    float horizontalStretchFactor = rect.width() / (float)srcRect.width();
    float verticalStretchFactor = rect.height() / (float)srcRect.height();

    auto player = g_game.getLocalPlayer();
    auto floor = player->getPosition().z;
    for (auto& tile : m_cachedVisibleTiles[floor]) {
        Position tilePos = tile->getPosition();
        if (tilePos.z != player->getPosition().z) continue;

        Point p = transformPositionTo2D(tilePos, cameraPosition) - drawOffset;
        p.x *= horizontalStretchFactor;
        p.y *= verticalStretchFactor;
        p += rect.topLeft();

        size_t drawQueueStart = g_drawQueue->size();
        tile->drawWidget(p);
        g_drawQueue->setClip(drawQueueStart, rect);
    }
}

void MapView::drawMapBackground(const Rect& rect, const TilePtr& crosshairTile) {
    Position cameraPosition = getCameraPosition();
    if (m_mustUpdateVisibleTilesCache) {
        updateVisibleTilesCache();
    }

    if (g_game.getFeature(Otc::GameForceLight)) {
        m_drawLight = true;
        m_minimumAmbientLight = 0.05f;
    }

    Rect srcRect = calcFramebufferSource(rect.size());
    const float renderScale = m_antiAliasingMode == AntialiasingSmoothRetro ? 2.f : 1.f;
    g_drawQueue->setFrameBuffer(rect, m_optimizedSize, srcRect, renderScale);

    // ponytail: no LightView in isometric; it is an orthogonal per-tile grid.
    // Upgrade path: draw the light texture through the iso affine transform.

    int firstFloor = m_floorFading > 0 ? m_cachedFirstFadingFloor : m_cachedFirstVisibleFloor;
    std::vector<float> fading(g_gameConfig.getMapMaxZ() + 1, 0.f);
    for (int z = m_cachedLastVisibleFloor; z >= firstFloor; --z) {
        fading[z] = 1.f;
        if (m_floorFading > 0) {
            fading[z] = stdext::clamp<float>((float)m_fadingFloorTimers[z].elapsed_millis() / (float)m_floorFading, 0.f, 1.f);
            if (z < m_cachedFirstVisibleFloor)
                fading[z] = 1.f - fading[z];
        }
    }

    // all visible floors in one back-to-front pass, so a low tile in front of a
    // higher-floor cliff is drawn after it; per-tile order stays ground..top
    const int s = g_sprites.spriteSize();
    for (const TilePtr& tile : m_cachedSortedTiles) {
        const int z = tile->getPosition().z;
        if (fading[z] <= 0.f)
            continue;

        const size_t start = g_drawQueue->size();
        const Point tileDrawPos = transformPositionTo2D(tile->getPosition(), cameraPosition);
        tile->drawGround(tileDrawPos, nullptr);
        tile->drawBottom(tileDrawPos, nullptr);
        tile->drawLootHighlights(tileDrawPos, nullptr);
        if (m_crosshair && tile == crosshairTile)
            g_drawQueue->addTexturedRect(Rect(tileDrawPos, Size(s, s / 2)), m_crosshair, Rect(0, 0, m_crosshair->getSize()));
        tile->drawCreatures(tileDrawPos, nullptr);
        tile->drawTop(tileDrawPos, nullptr);

        if (fading[z] < 0.99f)
            g_drawQueue->setOpacity(start, fading[z]);
    }

    for (int z = m_cachedLastVisibleFloor; z >= firstFloor; --z) {
        if (fading[z] <= 0.f)
            continue;
        for (const MissilePtr& missile : g_map.getFloorMissiles(z))
            missile->draw(transformPositionTo2D(missile->getPosition(), cameraPosition), true, nullptr);
    }

    if(!m_shader.empty() && isFollowingCreature()) {
        g_drawQueue->setShader(m_shader);

        Point walkOffset = transformPositionTo2D(getCameraPosition(), m_shaderPosition);
        walkOffset.y = -walkOffset.y;

        g_drawQueue->setWalkOffset(
            PointF(
                (walkOffset.x / static_cast<float>(m_optimizedSize.width())),
                (walkOffset.y / static_cast<float>(m_optimizedSize.height()))
            )
        );
    }
}

void MapView::setShader(const std::string& shader)
{
    m_shader = shader;
    if (!m_shader.empty())
        m_shaderPosition = getCameraPosition();
}


void MapView::drawMapForeground(const Rect& rect)
{
    // this could happen if the player position is not known yet
    Position cameraPosition = getCameraPosition();
    if (!cameraPosition.isValid())
        return;

    Rect srcRect = calcFramebufferSource(rect.size());
    Point drawOffset = srcRect.topLeft();
    float horizontalStretchFactor = rect.width() / (float)srcRect.width();
    float verticalStretchFactor = rect.height() / (float)srcRect.height();

    // creatures
    std::vector<std::pair<CreaturePtr, Point>> creatures;
    const int range = m_virtualCenterOffset.x; // the visible screen is a diamond of this grid radius
    for (const CreaturePtr& creature : g_map.getSpectatorsInRangeEx(cameraPosition, false, range, range, range, range)) {
        if (!creature->canBeSeen())
            continue;

        PointF jumpOffset = creature->getJumpOffset();
        Point creatureOffset = Point(16 * g_sprites.getOffsetFactor() - creature->getDisplacementX(), -creature->getDisplacementY() - 2 * g_sprites.getOffsetFactor());
        Position pos = creature->getPrewalkingPosition();
        Point p = transformPositionTo2D(pos, cameraPosition) - drawOffset;
        p += (creature->getDrawOffset() + creatureOffset) - Point(jumpOffset.x, jumpOffset.y);
        p.x = p.x * horizontalStretchFactor;
        p.y = p.y * verticalStretchFactor;
        p += rect.topLeft();
        creatures.push_back(std::make_pair(creature, p));
    }

    for (auto& c : creatures) {
        int flags = Otc::DrawIcons;
        if (m_drawNames) { flags |= Otc::DrawNames; }
        if ((!c.first->isLocalPlayer() || m_drawPlayerBars) && !m_drawHealthBarsOnTop) {
            if (m_drawHealthBars) { flags |= Otc::DrawBars; }
            if (m_drawManaBar) { flags |= Otc::DrawManaBar; }
        }
        c.first->drawInformation(c.second, g_map.isCovered(c.first->getPrewalkingPosition(), m_cachedFirstVisibleFloor), rect, flags);
    }

    if (m_lightView) {
        g_drawQueue->add(std::move(m_lightView));
    }

    // texts
    int limit = g_adaptiveRenderer.textsLimit();
    for (int i = 0; i < 2; ++i) {
        for (const StaticTextPtr& staticText : g_map.getStaticTexts()) {
            Position pos = staticText->getPosition();

            if (pos.z != cameraPosition.z && staticText->getMessageMode() == Otc::MessageNone)
                continue;
            if ((staticText->getMessageMode() != Otc::MessageSay && staticText->getMessageMode() != Otc::MessageYell)) {
                if (i == 0)
                    continue;
            } else if (i == 1)
                continue;

            Point p = transformPositionTo2D(pos, cameraPosition) - drawOffset + Point(8, 0) * g_sprites.getOffsetFactor();
            p.x *= horizontalStretchFactor;
            p.y *= verticalStretchFactor;
            p += rect.topLeft();
            staticText->drawText(p, rect);
            if (--limit == 0)
                break;
        }
    }

    limit = g_adaptiveRenderer.textsLimit();
    for (const AnimatedTextPtr& animatedText : g_map.getAnimatedTexts()) {
        Position pos = animatedText->getPosition();

        if (pos.z != cameraPosition.z)
            continue;

        Point p = transformPositionTo2D(pos, cameraPosition) - drawOffset + Point(16, 8) * g_sprites.getOffsetFactor();
        p.x *= horizontalStretchFactor;
        p.y *= verticalStretchFactor;
        p += rect.topLeft();
        animatedText->drawText(p, rect);
        if (--limit == 0)
            break;
    }

    // tile texts
    drawTileTexts(rect, srcRect);

    // bars on top
    if (m_drawHealthBarsOnTop) {
        for (auto& c : creatures) {
            int flags = 0;
            if ((!c.first->isLocalPlayer() || m_drawPlayerBars)) {
                if (m_drawHealthBars) { flags |= Otc::DrawBars; }
                if (m_drawManaBar) { flags |= Otc::DrawManaBar; }
            }
            c.first->drawInformation(c.second, g_map.isCovered(c.first->getPrewalkingPosition(), m_cachedFirstVisibleFloor), rect, flags);
        }
    }
	
	drawTileWidget(rect, srcRect);
}


void MapView::updateVisibleTilesCache()
{
    int prevFirstVisibleFloor = m_cachedFirstVisibleFloor;
    m_cachedFirstVisibleFloor = calcFirstVisibleFloor(false);
    m_cachedFirstFadingFloor = calcFirstVisibleFloor(true);
    m_cachedLastVisibleFloor = calcLastVisibleFloor();

    VALIDATE(m_cachedFirstVisibleFloor >= 0 && m_cachedLastVisibleFloor >= 0 &&
            m_cachedFirstVisibleFloor <= g_gameConfig.getMapMaxZ() && m_cachedLastVisibleFloor <= g_gameConfig.getMapMaxZ());

    if(m_cachedLastVisibleFloor < m_cachedFirstVisibleFloor)
        m_cachedLastVisibleFloor = m_cachedFirstVisibleFloor;

    m_mustUpdateVisibleTilesCache = false;

    // there is no tile to render on invalid positions
    Position cameraPosition = getCameraPosition();
    if (!cameraPosition.isValid()) {
        return;
    }

    // fading
    if (!m_lastCameraPosition.isValid() || m_lastCameraPosition.z != cameraPosition.z || m_lastCameraPosition.distance(cameraPosition) >= 3) { 
        for (int iz = m_cachedLastVisibleFloor; iz >= m_cachedFirstFadingFloor; --iz) {
            m_fadingFloorTimers[iz].restart(m_floorFading * 1000);
        }
    } else if (prevFirstVisibleFloor < m_cachedFirstVisibleFloor) { // showing new floor
        for (int iz = prevFirstVisibleFloor; iz < m_cachedFirstVisibleFloor; ++iz) {
            int shift = std::max<int>(0, m_floorFading - m_fadingFloorTimers[iz].elapsed_millis());
            m_fadingFloorTimers[iz].restart(shift * 1000);
        }
    } else if (prevFirstVisibleFloor > m_cachedFirstVisibleFloor) { // hiding floor
        for (int iz = m_cachedFirstVisibleFloor; iz < prevFirstVisibleFloor; ++iz) {
            int shift = std::max<int>(0, m_floorFading - m_fadingFloorTimers[iz].elapsed_millis());
            m_fadingFloorTimers[iz].restart(shift * 1000);
        }
    }

    m_lastCameraPosition = cameraPosition;

    const int numDiagonals = m_drawDimension.width() + m_drawDimension.height() - 1;
    for (auto& cachedVisibleTiles : m_cachedVisibleTiles) {
        cachedVisibleTiles.clear();
    }

    // draw from last floor (the lower) to first floor (the higher)
    for(int iz = m_cachedLastVisibleFloor; iz >= (m_floorFading ? m_cachedFirstFadingFloor : m_cachedFirstVisibleFloor); --iz) {
        for (int diagonal = 0; diagonal < numDiagonals; ++diagonal) {
            // loop current diagonal tiles
            int advance = std::max<int>(diagonal - m_drawDimension.height(), 0);
            for (int iy = diagonal - advance, ix = advance; iy >= 0 && ix < m_drawDimension.width(); --iy, ++ix) {
                // position on current floor
                //TODO: check position limits
                Position tilePos = cameraPosition.translated(ix - m_virtualCenterOffset.x, iy - m_virtualCenterOffset.y);
                // adjust tilePos to the wanted floor
                tilePos.coveredUp(cameraPosition.z - iz);
                if (const TilePtr& tile = g_map.getTile(tilePos)) {
                    if (!tile->isDrawable())
                        continue;
                    m_cachedVisibleTiles[tilePos.z].push_back(tile);
                    tile->calculateCorpseCorrection();
                }
            }
        }
    }

    // depth sort for the isometric painter: (x+y) back to front, lower floor first on ties
    m_cachedSortedTiles.clear();
    for (int iz = m_cachedLastVisibleFloor; iz >= 0; --iz)
        m_cachedSortedTiles.insert(m_cachedSortedTiles.end(), m_cachedVisibleTiles[iz].begin(), m_cachedVisibleTiles[iz].end());
    std::stable_sort(m_cachedSortedTiles.begin(), m_cachedSortedTiles.end(), [](const TilePtr& a, const TilePtr& b) {
        const Position& pa = a->getPosition();
        const Position& pb = b->getPosition();
        const int da = pa.x + pa.y, db = pb.x + pb.y;
        return da != db ? da < db : pa.z > pb.z;
    });
}

void MapView::updateGeometry(const Size& visibleDimension, const Size& optimizedSize)
{
    m_multifloor = true;
    m_visibleDimension = visibleDimension;

    // visible area stays w*s x h*s pixels; the grid square around the camera that
    // covers it in 2:1 iso has radius (w + 2h) / 2, plus a margin for tall sprites
    const int s = g_sprites.spriteSize();
    const int radius = (visibleDimension.width() + 2 * visibleDimension.height() + 1) / 2 + 2;
    const int n = 2 * radius + 1;
    m_drawDimension = Size(n, n);
    m_virtualCenterOffset = Point(radius, radius);
    m_visibleCenterOffset = m_virtualCenterOffset;
    m_isoOrigin = Point((n - 1) * s / 2, 2 * s);
    m_optimizedSize = Size(n * s, n * s / 2 + 3 * s);
    requestVisibleTilesCacheUpdate();
}

void MapView::onTileUpdate(const Position& pos)
{
    requestVisibleTilesCacheUpdate();
}

void MapView::onMapCenterChange(const Position& pos)
{
    requestVisibleTilesCacheUpdate();
}

void MapView::lockFirstVisibleFloor(int firstVisibleFloor)
{
    m_lockedFirstVisibleFloor = firstVisibleFloor;
    requestVisibleTilesCacheUpdate();
}

void MapView::unlockFirstVisibleFloor()
{
    m_lockedFirstVisibleFloor = -1;
    requestVisibleTilesCacheUpdate();
}

void MapView::setVisibleDimension(const Size& visibleDimension)
{
    //if(visibleDimension == m_visibleDimension)
    //    return;

    if(visibleDimension.width() % 2 != 1 || visibleDimension.height() % 2 != 1) {
        g_logger.traceError("visible dimension must be odd");
        return;
    }

    if(visibleDimension < Size(3,3)) {
        g_logger.traceError("reach max zoom in");
        return;
    }

    updateGeometry(visibleDimension, m_optimizedSize);
}

void MapView::optimizeForSize(const Size& visibleSize)
{
    updateGeometry(m_visibleDimension, visibleSize);
}

void MapView::followCreature(const CreaturePtr& creature)
{
    m_follow = true;
    m_followingCreature = creature;
    requestVisibleTilesCacheUpdate();
}

void MapView::setCameraPosition(const Position& pos)
{
    m_follow = false;
    m_customCameraPosition = pos;
    requestVisibleTilesCacheUpdate();
}

Position MapView::getPosition(const Point& point, const Size& mapSize)
{
    Position cameraPosition = getCameraPosition();

    // if we have no camera, its impossible to get the tile
    if(!cameraPosition.isValid())
        return Position();

    const Point cell = Iso::screenToCell(toFramebuffer(point, mapSize) - m_isoOrigin, g_sprites.spriteSize()) - m_virtualCenterOffset;
    if(cell.x + cameraPosition.x < 0 || cell.y + cameraPosition.y < 0)
        return Position();

    Position position = Position(cell.x, cell.y, 0) + cameraPosition;

    if(!position.isValid())
        return Position();

    return position;
}

Point MapView::getPositionOffset(const Point& point, const Size& mapSize)
{
    Position cameraPosition = getCameraPosition();
    Position position = getPosition(point, mapSize);

    // if we have no camera, its impossible to get the tile
    if (!cameraPosition.isValid() || !position.isValid())
        return Point(0, 0);

    // pixel offset from the tile draw point (diamond bbox top-left), as creature hit-tests expect
    return toFramebuffer(point, mapSize) - transformPositionTo2D(position, cameraPosition);
}

TilePtr MapView::pickTile(const Point& point, const Size& mapSize)
{
    Position cameraPosition = getCameraPosition();
    if (!cameraPosition.isValid())
        return nullptr;

    const int s = g_sprites.spriteSize();
    const Point p = toFramebuffer(point, mapSize) - m_isoOrigin;
    const Point cell = Iso::screenToCell(p, s);

    // front neighbours first: item elevation lifts their diamond over the raw cell
    static const Point candidates[] = { Point(1, 1), Point(1, 0), Point(0, 1), Point(0, 0) };
    for (int z = m_cachedFirstVisibleFloor; z <= m_cachedLastVisibleFloor; ++z) {
        for (const Point& d : candidates) {
            const Point c = cell + d;
            Position pos = cameraPosition.translated(c.x - m_virtualCenterOffset.x, c.y - m_virtualCenterOffset.y);
            pos.coveredUp(cameraPosition.z - z);
            const TilePtr& tile = g_map.getTile(pos);
            if (!tile || !tile->isClickable())
                continue;
            const int elevation = tile->getDrawElevation() * g_sprites.getOffsetFactor();
            if (d == Point(0, 0) || (elevation > 0 && Iso::insideDiamond(p + Point(0, elevation), c, s)))
                return tile;
        }
    }
    return nullptr;
}

Point MapView::toFramebuffer(const Point& point, const Size& mapSize)
{
    Rect srcRect = calcFramebufferSource(mapSize);
    float sh = srcRect.width() / (float)mapSize.width();
    float sv = srcRect.height() / (float)mapSize.height();
    return Point(point.x * sh, point.y * sv) + srcRect.topLeft();
}

void MapView::move(int x, int y)
{
    m_moveOffset.x += x;
    m_moveOffset.y += y;

    int32_t tmp = m_moveOffset.x / g_sprites.spriteSize();
    bool requestTilesUpdate = false;
    if(tmp != 0) {
        m_customCameraPosition.x += tmp;
        m_moveOffset.x %= g_sprites.spriteSize();
        requestTilesUpdate = true;
    }

    tmp = m_moveOffset.y / g_sprites.spriteSize();
    if(tmp != 0) {
        m_customCameraPosition.y += tmp;
        m_moveOffset.y %= g_sprites.spriteSize();
        requestTilesUpdate = true;
    }

    if(requestTilesUpdate)
        requestVisibleTilesCacheUpdate();
}

Rect MapView::calcFramebufferSource(const Size& destSize, bool inNextFrame)
{
    const int s = g_sprites.spriteSize();
    Size srcVisible = m_visibleDimension * s;

    // center the visible rect on the camera cell's diamond center; the walk offset is already screen space
    Point cameraCenter = m_isoOrigin + Iso::delta(m_virtualCenterOffset.x, m_virtualCenterOffset.y, s) + Point(s / 2, s / 4);
    Point drawOffset = cameraCenter - Point(srcVisible.width() / 2, srcVisible.height() / 2);
    if(isFollowingCreature())
        drawOffset += m_followingCreature->getWalkOffset(inNextFrame);

    Size srcSize = destSize;
    srcSize.scale(srcVisible, Fw::KeepAspectRatio);
    drawOffset.x += (srcVisible.width() - srcSize.width()) / 2;
    drawOffset.y += (srcVisible.height() - srcSize.height()) / 2;

    return Rect(drawOffset, srcSize);
}

int MapView::calcFirstVisibleFloor(bool forFading)
{
    int z = 7;
    // return forced first visible floor
    if(m_lockedFirstVisibleFloor != -1) {
        z = m_lockedFirstVisibleFloor;
    } else {
        Position cameraPosition = getCameraPosition();

        // this could happens if the player is not known yet
        if(cameraPosition.isValid()) {
            // avoid rendering multifloors in far views
            if(!m_multifloor) {
                z = cameraPosition.z;
            } else {
                // if nothing is limiting the view, the first visible floor is 0
                int firstFloor = 0;

                // limits to underground floors while under sea level
                if(cameraPosition.z > g_gameConfig.getMapSeaFloor())
                    firstFloor = std::max<int>(cameraPosition.z - g_gameConfig.getMapAwareUndergroundFloorRange(), g_gameConfig.getMapUndergroundFloor());

                // loop in 3x3 tiles around the camera
                for(int ix = -1; ix <= 1 && firstFloor < cameraPosition.z && !forFading; ++ix) {
                    for(int iy = -1; iy <= 1 && firstFloor < cameraPosition.z; ++iy) {
                        Position pos = cameraPosition.translated(ix, iy);

                        // process tiles that we can look through, e.g. windows, doors
                        if((ix == 0 && iy == 0) || ((std::abs(ix) != std::abs(iy)) && g_map.isLookPossible(pos))) {
                            Position upperPos = pos;
                            Position coveredPos = pos;

                            while(coveredPos.coveredUp() && upperPos.up() && upperPos.z >= firstFloor) {
                                // check tiles physically above
                                TilePtr tile = g_map.getTile(upperPos);
                                if(tile && tile->limitsFloorsView(!g_map.isLookPossible(pos))) {
                                    firstFloor = upperPos.z + 1;
                                    break;
                                }

                                // check tiles geometrically above
                                tile = g_map.getTile(coveredPos);
                                if(tile && tile->limitsFloorsView(g_map.isLookPossible(pos))) {
                                    firstFloor = coveredPos.z + 1;
                                    break;
                                }
                            }
                        }
                    }
                }
                z = firstFloor;
            }
        }
    }

    // just ensure the that the floor is in the valid range
    z = stdext::clamp<int>(z, 0, g_gameConfig.getMapMaxZ());
    return z;
}

int MapView::calcLastVisibleFloor()
{
    if(!m_multifloor)
        return calcFirstVisibleFloor();

    int z = 7;

    Position cameraPosition = getCameraPosition();
    // this could happens if the player is not known yet
    if(cameraPosition.isValid()) {
        // view only underground floors when below sea level
        if(cameraPosition.z > g_gameConfig.getMapSeaFloor())
            z = cameraPosition.z + g_gameConfig.getMapAwareUndergroundFloorRange();
        else
            z = g_gameConfig.getMapSeaFloor();
    }

    if(m_lockedFirstVisibleFloor != -1)
        z = std::max<int>(m_lockedFirstVisibleFloor, z);

    // just ensure the that the floor is in the valid range
    z = stdext::clamp<int>(z, 0, g_gameConfig.getMapMaxZ());
    return z;
}

Point MapView::transformPositionTo2D(const Position& position, const Position& relativePosition) {
    // the (-dz,-dz) floor shift of Tibia projects to exactly s/2 pixels up per floor
    const int dz = relativePosition.z - position.z;
    return m_isoOrigin + Iso::delta(m_virtualCenterOffset.x + (position.x - relativePosition.x) - dz,
                                    m_virtualCenterOffset.y + (position.y - relativePosition.y) - dz, g_sprites.spriteSize());
}


Position MapView::getCameraPosition()
{
    if (isFollowingCreature()) {
        return m_followingCreature->getPrewalkingPosition();
    }

    return m_customCameraPosition;
}

void MapView::setDrawLights(bool enable)
{
    m_drawLight = enable;
}

void MapView::setAntiAliasingMode(uint8_t mode)
{
    if (mode < AntialiasingDisabled || mode > AntialiasingSmoothRetro)
        mode = AntialiasingDisabled;

    m_antiAliasingMode = mode;
}

void MapView::setCrosshair(const std::string& file)     
{
    if (file == "")
        m_crosshair = nullptr;
    else
        m_crosshair = g_textures.getTexture(file);
}

/* vim: set ts=4 sw=4 et: */
