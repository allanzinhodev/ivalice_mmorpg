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

#include "uiprogressrect.h"
#include <framework/otml/otml.h>
#include <framework/graphics/graphics.h>
#include <framework/graphics/fontmanager.h>
#include <framework/core/clock.h>
#include <framework/core/eventdispatcher.h>
#include <memory>

namespace {
constexpr int PROGRESS_UPDATE_INTERVAL = 100;
}

UIProgressRect::UIProgressRect()
{
    m_percent = 0;
    m_updateEvent = nullptr;
    m_duration = 0;
    m_timeElapsed = 0;
    m_startTime = 0;
    m_running = false;
}

UIProgressRect::~UIProgressRect()
{
    stop();
}

void UIProgressRect::drawSelf(Fw::DrawPane drawPane)
{
    if(drawPane != Fw::ForegroundPane)
        return;

    // todo: check +1 to right/bottom
    // todo: add smooth
    Rect drawRect = getPaddingRect();

    if (m_showProgress) {
        // 0% - 12.5% (12.5)
        // triangle from top center, to top right (var x)
        if(m_percent < 12.5) {
            Point var = Point(std::max<int>(m_percent - 0.0, 0.0) * (drawRect.right() - drawRect.horizontalCenter()) / 12.5, 0);
            g_drawQueue->addFilledTriangle(drawRect.center(), drawRect.topRight() + Point(1,0), drawRect.topCenter() + var, m_backgroundColor);
        }

        // 12.5% - 37.5% (25)
        // triangle from top right to bottom right (var y)
        if(m_percent < 37.5) {
            Point var = Point(0, std::max<int>(m_percent - 12.5, 0.0) * (drawRect.bottom() - drawRect.top()) / 25.0);
            g_drawQueue->addFilledTriangle(drawRect.center(), drawRect.bottomRight() + Point(1,1), drawRect.topRight() + var + Point(1,0), m_backgroundColor);
        }

        // 37.5% - 62.5% (25)
        // triangle from bottom right to bottom left (var x)
        if(m_percent < 62.5) {
            Point var = Point(std::max<int>(m_percent - 37.5, 0.0) * (drawRect.right() - drawRect.left()) / 25.0, 0);
            g_drawQueue->addFilledTriangle(drawRect.center(), drawRect.bottomLeft() + Point(0,1), drawRect.bottomRight() - var + Point(1,1), m_backgroundColor);
        }

        // 62.5% - 87.5% (25)
        // triangle from bottom left to top left
        if(m_percent < 87.5) {
            Point var = Point(0, std::max<int>(m_percent - 62.5, 0.0) * (drawRect.bottom() - drawRect.top()) / 25.0);
            g_drawQueue->addFilledTriangle(drawRect.center(), drawRect.topLeft(), drawRect.bottomLeft() - var + Point(0,1), m_backgroundColor);
        }

        // 87.5% - 100% (12.5)
        // triangle from top left to top center
        if(m_percent < 100) {
            Point var = Point(std::max<int>(m_percent - 87.5, 0.0) * (drawRect.horizontalCenter() - drawRect.left()) / 12.5, 0);
            g_drawQueue->addFilledTriangle(drawRect.center(), drawRect.topCenter(), drawRect.topLeft() + var, m_backgroundColor);
        }
    }

    drawImage(m_rect);
    drawBorder(m_rect);
    drawIcon(m_rect);
    drawText(m_rect);
}

void UIProgressRect::setPercent(float percent)
{
    float clampedPercent = stdext::clamp<float>((double)percent, 0.0, 100.0);
    if(m_percent == clampedPercent)
        return;

    m_percent = clampedPercent;
}

void UIProgressRect::stop()
{
    if(m_updateEvent) {
        m_updateEvent->cancel();
        m_updateEvent = nullptr;
    }

    if(m_running) {
        m_timeElapsed = getTimeElapsed();
        m_running = false;
    }
}

void UIProgressRect::setDuration(uint32 duration)
{
    m_duration = duration;
    m_timeElapsed = 0;
}

void UIProgressRect::start()
{
    stop();

    m_timeElapsed = 0;
    if(m_duration == 0) {
        setPercent(100);
        if(m_showTime)
            setText("");
        callLuaField("onTimeEnd");
        callLuaField("onProgressFinish");
        return;
    }

    m_running = true;
    m_startTime = g_clock.millis();

    setPercent(0);
    if(m_showTime)
        setText("");

    updateProgress();
}

void UIProgressRect::showTime(bool showTime)
{
    if(m_showTime == showTime)
        return;

    m_showTime = showTime;
    if(!m_showTime)
        setText("");
    else if(m_running)
        updateProgressText(m_timeElapsed >= m_duration ? 0 : m_duration - m_timeElapsed);
}

void UIProgressRect::showProgress(bool showProgress)
{
    if(m_showProgress == showProgress)
        return;

    m_showProgress = showProgress;
}

uint32 UIProgressRect::getTimeElapsed()
{
    if(m_running) {
        ticks_t elapsed = g_clock.millis() - m_startTime;
        if(elapsed < 0)
            elapsed = 0;
        return std::min<uint32>((uint32)elapsed, m_duration);
    }

    return std::min<uint32>(m_timeElapsed, m_duration);
}

void UIProgressRect::scheduleNextUpdate()
{
    std::weak_ptr<UIProgressRect> weakSelf = static_self_cast<UIProgressRect>();
    m_updateEvent = g_dispatcher.scheduleEvent([weakSelf] {
        if(auto self = weakSelf.lock()) {
            self->m_updateEvent = nullptr;
            self->updateProgress();
        }
    }, PROGRESS_UPDATE_INTERVAL);
}

void UIProgressRect::updateProgress()
{
    if(isDestroyed()) {
        m_running = false;
        return;
    }

    if(!m_running)
        return;

    m_timeElapsed = getTimeElapsed();
    uint32 remainingTimeMs = m_timeElapsed >= m_duration ? 0 : m_duration - m_timeElapsed;
    float percent = m_duration > 0 ? (m_timeElapsed * 100.0f) / m_duration : 100.0f;

    setPercent(percent);
    updateProgressText(remainingTimeMs);
    callLuaField("onProgressUpdate", m_percent, remainingTimeMs, m_timeElapsed);

    if(m_timeElapsed >= m_duration) {
        stop();
        setPercent(100);
        if(m_showTime)
            setText("");
        callLuaField("onTimeEnd");
        callLuaField("onProgressFinish");
        return;
    }

    scheduleNextUpdate();
}

void UIProgressRect::updateProgressText(uint32 remainingTimeMs)
{
    if(!m_showTime)
        return;

    if(remainingTimeMs == 0) {
        setText("");
        return;
    }

    setText(std::to_string((remainingTimeMs + 999) / 1000));
}

void UIProgressRect::onStyleApply(const std::string& styleName, const OTMLNodePtr& styleNode)
{
    UIWidget::onStyleApply(styleName, styleNode);

    for(const OTMLNodePtr& node : styleNode->children()) {
        if(node->tag() == "percent")
            setPercent(node->value<float>());
        else if(node->tag() == "duration")
            setDuration(node->value<uint32>());
        else if(node->tag() == "show-time")
            showTime(node->value<bool>());
        else if(node->tag() == "show-progress")
            showProgress(node->value<bool>());
    }
}
