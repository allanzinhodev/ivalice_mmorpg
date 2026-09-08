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

#ifndef UIPROGRESSRECT_H
#define UIPROGRESSRECT_H

#include "declarations.h"
#include <framework/core/declarations.h>
#include <framework/ui/uiwidget.h>
#include "item.h"

class UIProgressRect : public UIWidget
{
public:
    UIProgressRect();
    virtual ~UIProgressRect();
    void drawSelf(Fw::DrawPane drawPane);

    void setPercent(float percent);
    float getPercent() { return m_percent; }
    void stop();
    void setDuration(uint32 duration);
    void start();
    void showTime(bool showTime);
    void showProgress(bool showProgress);
    uint32 getTimeElapsed();
    uint32 getDuration() { return m_duration; }

protected:
    void onStyleApply(const std::string& styleName, const OTMLNodePtr& styleNode);

private:
    void scheduleNextUpdate();
    void updateProgress();
    void updateProgressText(uint32 remainingTimeMs);

    float m_percent;
    ScheduledEventPtr m_updateEvent;
    uint32 m_duration;
    uint32 m_timeElapsed;
    ticks_t m_startTime;
    bool m_showTime = true;
    bool m_showProgress = true;
    bool m_running;
};

#endif
