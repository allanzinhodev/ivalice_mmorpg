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
#include <cmath>

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

    if (m_drawLight) {
        Light ambientLight;
        if (cameraPosition.z <= g_gameConfig.getMapSeaFloor())
            ambientLight = g_map.getLight();
        // O grid de luz e indexado por (pixel / spriteSize) -- ver
        // LightView::setFieldBrightness. Com a projecao isometrica o campo de
        // tiles nao cabe mais num grid m_drawDimension: os pixels vao ate
        // m_optimizedSize, entao o grid tem que cobrir o framebuffer inteiro.
        // Dimensionar pelo drawDimension deixava a maioria dos tiles fora do
        // grid, sem luz nenhuma -- tela preta.
        const Size lightSize((m_optimizedSize.width() + g_sprites.spriteSize() - 1) / g_sprites.spriteSize(),
                             (m_optimizedSize.height() + g_sprites.spriteSize() - 1) / g_sprites.spriteSize());
        if (!m_lightTexture || m_lightTexture->getSize() != lightSize)
            m_lightTexture = std::make_shared<Texture>(lightSize, false, true);
        m_lightView = std::make_unique<LightView>(m_lightTexture, lightSize, rect, srcRect, ambientLight.color,
                                                  std::max<int>(m_minimumAmbientLight * 255, ambientLight.intensity));
    }

    int firstFloor = m_floorFading > 0 ? m_cachedFirstFadingFloor : m_cachedFirstVisibleFloor;
    for (int z = m_cachedLastVisibleFloor; z >= firstFloor; --z) {
        float fading = 1.0;
        if (m_floorFading > 0) {
            fading = stdext::clamp<float>((float)m_fadingFloorTimers[z].elapsed_millis() / (float)m_floorFading, 0.f, 1.f);
            if (z < m_cachedFirstVisibleFloor)
                fading = 1.0 - fading;
            if (fading == 0) break;
        }

        if (g_game.getFeature(Otc::GameDrawFloorShadow)) {
            if (cameraPosition.z >= g_gameConfig.getMapUndergroundFloor() && cameraPosition.z == z) {
                g_drawQueue->addFilledRect(srcRect, m_floorShadow);
            }
        }
        size_t floorStart = g_drawQueue->size();
        drawFloor(z, cameraPosition, crosshairTile);

        if (fading < 0.99)
            g_drawQueue->setOpacity(floorStart, fading);
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

void MapView::drawFloor(short floor, const Position& cameraPosition, const TilePtr& crosshairTile)
{
    if (floor < 0 || floor > g_gameConfig.getMapMaxZ())
        return;

    auto& tiles = m_cachedVisibleTiles[floor];
    size_t lightFloorStart = m_lightView ? m_lightView->size() : 0;

    // light
    if (m_lightView) {
        for (auto& tile : tiles) {
            Point tileDrawPos = transformPositionTo2D(tile->getPosition(), cameraPosition);
            ItemPtr ground = tile->getGround();
            if (ground && ground->isGround() && !ground->isTranslucent()) {
                m_lightView->setFieldBrightness(tileDrawPos, lightFloorStart, 0);
            }
        }
    }

    if (g_game.getFeature(Otc::GameMapDrawGroundFirst)) {
        // ground
        for (auto& tile : tiles) {
            Point tileDrawPos = transformPositionTo2D(tile->getPosition(), cameraPosition);
            tile->drawGround(tileDrawPos, m_lightView.get());
        }
        // bottom, creatures, top
        for (auto& tile : tiles) {
            Point tileDrawPos = transformPositionTo2D(tile->getPosition(), cameraPosition);

            tile->drawBottom(tileDrawPos, m_lightView.get());

            if (m_crosshair && tile == crosshairTile) {
                g_drawQueue->addTexturedRect(Rect(tileDrawPos, tileDrawPos + g_sprites.spriteSize() - 1),
                                             m_crosshair, Rect(0, 0, m_crosshair->getSize()));
            }

            tile->drawCreatures(tileDrawPos, m_lightView.get());
            tile->drawTop(tileDrawPos, m_lightView.get());
        }
    } else {
        // ground, bottom, creatures, top
        for (auto& tile : tiles) {
            Point tileDrawPos = transformPositionTo2D(tile->getPosition(), cameraPosition);

            if (m_lightView) {
                ItemPtr ground = tile->getGround();
                if (ground && ground->isGround() && !ground->isTranslucent()) {
                    m_lightView->setFieldBrightness(tileDrawPos, lightFloorStart, 0);
                }
            }

            tile->drawGround(tileDrawPos, m_lightView.get());

            tile->drawBottom(tileDrawPos, m_lightView.get());

            if (m_crosshair && tile == crosshairTile) {
                g_drawQueue->addTexturedRect(Rect(tileDrawPos, tileDrawPos + g_sprites.spriteSize() - 1),
                                             m_crosshair, Rect(0, 0, m_crosshair->getSize()));
            }

            tile->drawCreatures(tileDrawPos, m_lightView.get());
            tile->drawTop(tileDrawPos, m_lightView.get());
        }
    }

    for (const MissilePtr& missile : g_map.getFloorMissiles(floor)) {
        missile->draw(transformPositionTo2D(missile->getPosition(), cameraPosition), true, m_lightView.get());
    }
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
    for (const CreaturePtr& creature : g_map.getSpectatorsInRangeEx(cameraPosition, false, m_visibleDimension.width() / 2, m_visibleDimension.width() / 2 + 1, m_visibleDimension.height() / 2, m_visibleDimension.height() / 2 + 1)) {
        if (!creature->canBeSeen())
            continue;

        PointF jumpOffset = creature->getJumpOffset();
        // Otc::HUD_SHIFT_X corrige o termo `16 - displacementX`, que foi escrito
        // para celula quadrada e nao serve para o losango. Ver const.h.
        Point creatureOffset = Point((16 + Otc::HUD_SHIFT_X) * g_sprites.getOffsetFactor() - creature->getDisplacementX(), -creature->getDisplacementY() - 2 * g_sprites.getOffsetFactor());
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
                // Ajusta para o andar desejado.
                //
                // O original usava coveredUp(), que codifica a equivalencia de
                // celula do Tibia: (x+1, y+1, z-1). Isso so vale porque la
                // subir um andar desloca uma diagonal. Com o lift vertical da
                // projecao isometrica a mesma celula (col,row) de outro andar
                // e (x, y, z-1) -- so muda o z.
                //
                // Position::coveredUp/coveredDown NAO foram alteradas: elas
                // seguem corretas para logica de linha de visao / teto
                // (map.cpp, calcFirstVisibleFloor), que e semantica de mundo.
                tilePos.z = static_cast<short>(iz);
                if (const TilePtr& tile = g_map.getTile(tilePos)) {
                    if (!tile->isDrawable())
                        continue;
                    m_cachedVisibleTiles[tilePos.z].push_back(tile);
                    tile->calculateCorpseCorrection();
                }
            }
        }
    }
}

void MapView::updateGeometry(const Size& visibleDimension, const Size& optimizedSize)
{
    m_multifloor = true;
    m_visibleDimension = visibleDimension;
    m_drawDimension = visibleDimension + Size(3, 3);
    m_virtualCenterOffset = (m_drawDimension / 2 - Size(1, 1)).toPoint();
    m_visibleCenterOffset = m_virtualCenterOffset;

    // --- Geometria isometrica ---
    // Os tiles desenhados vao de col=[-cx, w-1-cx] e row=[-cy, h-1-cy], onde
    // (cx,cy) = m_virtualCenterOffset. Projetando os quatro cantos:
    //   screenX = (col-row)*HW   -> extremos em (colMin-rowMax) e (colMax-rowMin)
    //   screenY = (col+row)*HH   -> extremos em (colMin+rowMin) e (colMax+rowMax)
    // A origem da projecao fica DENTRO desse campo, nao no topo -- foi o erro
    // que deixava metade do mapa fora da janela visivel.
    const int w = m_drawDimension.width();
    const int h = m_drawDimension.height();
    const int colMin = -m_virtualCenterOffset.x, colMax = w - 1 - m_virtualCenterOffset.x;
    const int rowMin = -m_virtualCenterOffset.y, rowMax = h - 1 - m_virtualCenterOffset.y;

    const int fieldLeft = (colMin - rowMax) * Otc::TILE_HALF_W;
    const int fieldRight = (colMax - rowMin) * Otc::TILE_HALF_W;
    const int fieldTop = (colMin + rowMin) * Otc::TILE_HALF_H;
    const int fieldBottom = (colMax + rowMax) * Otc::TILE_HALF_H;

    // Margens: sprites sao mais altos que a celula e ancorados pela base, o
    // lift de andares sobe a cena, e itens empilhados usam elevacao.
    const int marginTop = g_gameConfig.getMapMaxZ() * Otc::FLOOR_LIFT + g_sprites.spriteSize() + Otc::MAX_ELEVATION;
    const int marginBottom = g_sprites.spriteSize();
    const int marginX = g_sprites.spriteSize();

    m_optimizedSize = Size((fieldRight - fieldLeft) + marginX * 2,
                           (fieldBottom - fieldTop) + marginTop + marginBottom);

    // Origem da projecao: desloca o campo para dentro do framebuffer.
    m_projectionOffset = Point(marginX - fieldLeft, marginTop - fieldTop);

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

    Rect srcRect = calcFramebufferSource(mapSize);
    float sh = srcRect.width() / (float)mapSize.width();
    float sv = srcRect.height() / (float)mapSize.height();

    Point framebufferPos = Point(point.x * sh, point.y * sv);
    Point realPos = (framebufferPos + srcRect.topLeft());

    // Inversa da projecao isometrica (ver transformPositionTo2D).
    // De  sx = (col-row)*HW  e  sy = (col+row)*HH  segue:
    //   col = (sx/HW + sy/HH) / 2
    //   row = (sy/HH - sx/HW) / 2
    //
    // Usar std::floor em float: divisao inteira trunca em direcao a zero e
    // erraria o tile a esquerda/acima da camera (coordenadas negativas).
    const float sx = static_cast<float>(realPos.x - m_projectionOffset.x);
    const float sy = static_cast<float>(realPos.y - m_projectionOffset.y);
    const float fx = sx / static_cast<float>(Otc::TILE_HALF_W);
    const float fy = sy / static_cast<float>(Otc::TILE_HALF_H);

    Point tilePos2D(static_cast<int>(std::floor((fx + fy) / 2.0f)),
                    static_cast<int>(std::floor((fy - fx) / 2.0f)));

    if(tilePos2D.x + cameraPosition.x < 0 && tilePos2D.y + cameraPosition.y < 0)
        return Position();

    Position position = Position(tilePos2D.x, tilePos2D.y, 0) + cameraPosition;

    if(!position.isValid())
        return Position();

    return position;
}

Point MapView::getPositionOffset(const Point& point, const Size& mapSize)
{
    Position cameraPosition = getCameraPosition();

    // if we have no camera, its impossible to get the tile
    if (!cameraPosition.isValid())
        return Point(0, 0);

    Rect srcRect = calcFramebufferSource(mapSize);
    float sh = srcRect.width() / (float)mapSize.width();
    float sv = srcRect.height() / (float)mapSize.height();

    Point framebufferPos = Point(point.x * sh, point.y * sv);
    Point realPos = (framebufferPos + srcRect.topLeft());

    // Offset dentro da celula. O antigo "% spriteSize" assumia celula
    // quadrada; no losango medimos em relacao ao vertice superior do tile
    // que contem o ponto (reusa a inversa de getPosition).
    const float sx = static_cast<float>(realPos.x - m_projectionOffset.x);
    const float sy = static_cast<float>(realPos.y - m_projectionOffset.y);
    const float fx = sx / static_cast<float>(Otc::TILE_HALF_W);
    const float fy = sy / static_cast<float>(Otc::TILE_HALF_H);
    const int col = static_cast<int>(std::floor((fx + fy) / 2.0f));
    const int row = static_cast<int>(std::floor((fy - fx) / 2.0f));

    const Point tileOrigin(m_projectionOffset.x + (col - row) * Otc::TILE_HALF_W,
                           m_projectionOffset.y + (col + row) * Otc::TILE_HALF_H);
    return realPos - tileOrigin;
}

void MapView::move(int x, int y)
{
    m_moveOffset.x += x;
    m_moveOffset.y += y;

    // Converte o pan em pixels para passos de tile no espaco diamante.
    // Um passo em +x vale (+TILE_HALF_W, +TILE_HALF_H) na tela; em +y vale
    // (-TILE_HALF_W, +TILE_HALF_H). Invertendo, como em getPosition():
    //   dcol = (px/HW + py/HH) / 2      drow = (py/HH - px/HW) / 2
    const float fx = m_moveOffset.x / static_cast<float>(Otc::TILE_HALF_W);
    const float fy = m_moveOffset.y / static_cast<float>(Otc::TILE_HALF_H);
    const int dcol = static_cast<int>((fx + fy) / 2.0f);
    const int drow = static_cast<int>((fy - fx) / 2.0f);

    bool requestTilesUpdate = false;
    if(dcol != 0 || drow != 0) {
        m_customCameraPosition.x += dcol;
        m_customCameraPosition.y += drow;
        // Desconta o que virou passo inteiro, preservando o resto sub-tile.
        m_moveOffset.x -= (dcol - drow) * Otc::TILE_HALF_W;
        m_moveOffset.y -= (dcol + drow) * Otc::TILE_HALF_H;
        requestTilesUpdate = true;
    }

    if(requestTilesUpdate)
        requestVisibleTilesCacheUpdate();
}

Rect MapView::calcFramebufferSource(const Size& destSize, bool inNextFrame)
{
    // Janela visivel em espaco diamante. Calculada do mesmo jeito que o campo
    // em updateGeometry, mas com m_visibleDimension: os extremos vem dos
    // quatro cantos projetados, e a janela e centrada no tile da camera.
    const int vw = m_visibleDimension.width();
    const int vh = m_visibleDimension.height();
    const int cx = vw / 2, cy = vh / 2;
    const int colMin = -cx, colMax = vw - 1 - cx;
    const int rowMin = -cy, rowMax = vh - 1 - cy;

    const int left = (colMin - rowMax) * Otc::TILE_HALF_W;
    const int right = (colMax - rowMin) * Otc::TILE_HALF_W;
    const int top = (colMin + rowMin) * Otc::TILE_HALF_H;
    const int bottom = (colMax + rowMax) * Otc::TILE_HALF_H;

    Size srcVisible(right - left, bottom - top);

    // Canto superior-esquerdo da janela, relativo a origem da projecao.
    Point drawOffset(m_projectionOffset.x + left, m_projectionOffset.y + top);

    if(isFollowingCreature()) {
        // O walk offset ja vem projetado em espaco diamante (ver
        // Creature::updateWalkOffset), entao acompanha direto.
        drawOffset += m_followingCreature->getWalkOffset(inNextFrame);
    }

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
    // Projecao isometrica (losango 32x16). Ver Otc::TILE_HALF_W/H em const.h.
    //   screenX = offsetX + (col - row) * 16
    //   screenY = offsetY + (col + row) * 8
    const int col = position.x - relativePosition.x;
    const int row = position.y - relativePosition.y;

    // Altura: levantamento vertical puro, ao contrario do Tibia (que desloca
    // um tile na diagonal por andar). Por isso o termo de z sai de dentro do
    // parenteses e vira subtracao so em Y.
    const int dz = relativePosition.z - position.z;

    return Point(m_projectionOffset.x + (col - row) * Otc::TILE_HALF_W,
                 m_projectionOffset.y + (col + row) * Otc::TILE_HALF_H - dz * Otc::FLOOR_LIFT);
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
