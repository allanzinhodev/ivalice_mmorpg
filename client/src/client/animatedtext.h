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

#ifndef ANIMATEDTEXT_H
#define ANIMATEDTEXT_H

#include "thing.h"
#include <framework/graphics/fontmanager.h>
#include <framework/core/timer.h>
#include <framework/graphics/cachedtext.h>
#include <cmath>

// @bindclass
class AnimatedText : public Thing
{
public:
    AnimatedText();

    void drawText(const Point& dest, const Rect& visibleRect);

    void setColor(int color);
    void setText(const std::string& text);
    void setOffset(const Point& offset) { m_targetOffset = PointF(offset.x, offset.y); }
    void setFont(const std::string& fontName);

    Color getColor() { return m_color; }
    const CachedText& getCachedText() const { return m_cachedText; }
    Size getTextSize() { return m_cachedText.getTextSize(); }
    Point getOffset() { return Point(static_cast<int>(std::round(m_offset.x)), static_cast<int>(std::round(m_offset.y))); }
    Timer getTimer() { return m_animationTimer; }

    bool merge(const AnimatedTextPtr& other);

    AnimatedTextPtr asAnimatedText() { return static_self_cast<AnimatedText>(); }
    bool isAnimatedText() { return true; }
    std::string getText() { return m_cachedText.getText(); }

protected:
    virtual void onAppear();

private:
    void updateOffset(float dt);

    Color m_color;
    Timer m_animationTimer;
    Timer m_offsetTimer;
    CachedText m_cachedText;
    PointF m_offset;
    PointF m_targetOffset;
};

#endif
