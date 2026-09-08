-- @docclass
function g_mouse.bindAutoPress(widget, callback, delay, button, loopingDelay)
  if not loopingDelay then
    loopingDelay = 30
  end

  local button = button or MouseLeftButton
  connect(widget, { onMousePress = function(widget, mousePos, mouseButton)
    if mouseButton ~= button then
      return false
    end
    local startTime = g_clock.millis()
    callback(widget, mousePos, mouseButton, 0)
    periodicalEvent(function()
      callback(widget, g_window.getMousePosition(), mouseButton, g_clock.millis() - startTime)
    end, function()
      return g_mouse.isPressed(mouseButton)
    end, loopingDelay, delay)
    return true
  end })
end

function g_mouse.bindPressMove(widget, callback)
  connect(widget, { onMouseMove = function(widget, mousePos, mouseMoved)
    if widget:isPressed() then
      callback(mousePos, mouseMoved)
      return true
    end
  end })
end

function g_mouse.bindPress(widget, callback, button)
  connect(widget, { onMousePress = function(widget, mousePos, mouseButton)
    if not button or button == mouseButton then
      callback(mousePos, mouseButton)
      return true
    end
    return false
  end })
end

if not g_mouse.grabbedMouse then
  g_mouse.grabbedMouse = {}
end

local systemCursorByName = {
  horizontal = 'horizontal',
  vertical = 'vertical',
  pointer = 'hand',
  target = 'cross',
  text = 'text'
}

function g_mouse.applyNativeCursor(mouse)
  if not g_mouse.isUsingNativeCursor or not g_mouse.isUsingNativeCursor() then
    return false
  end

  if not g_window or not g_window.setSystemCursor then
    return false
  end

  g_window.setSystemCursor(systemCursorByName[mouse] or mouse)
  return true
end

function g_mouse.restoreNativeCursor()
  if not g_mouse.isUsingNativeCursor or not g_mouse.isUsingNativeCursor() then
    return false
  end

  if not g_window or not g_window.restoreMouseCursor then
    return false
  end

  g_window.restoreMouseCursor()
  return true
end

function g_mouse.getActiveGrabberCursor()
  for _, mouse in pairs(g_mouse.grabbedMouse) do
    if mouse ~= '' then
      return mouse
    end
  end

  return nil
end

function g_mouse.setGrabber(widget, mouse)
  if not widget then
    return false
  end

  g_mouse.grabbedMouse[widget] = mouse
  if mouse ~= '' then
    g_mouse.applyNativeCursor(mouse)
  end
  return true
end

function g_mouse.releaseGrabber(widget)
  if not widget or g_mouse.grabbedMouse[widget] == nil then
    return nil
  end

  local releasedMouse = g_mouse.grabbedMouse[widget]
  g_mouse.grabbedMouse[widget] = nil

  local nextMouse = g_mouse.getActiveGrabberCursor()
  if nextMouse then
    g_mouse.applyNativeCursor(nextMouse)
  else
    g_mouse.restoreNativeCursor()
  end

  return releasedMouse
end

function g_mouse.updateGrabber(widget, mouse)
  if not g_mouse.grabbedMouse[widget] then
    g_mouse.grabbedMouse[widget] = mouse
    g_mouse.applyNativeCursor(mouse)
  else
    g_mouse.grabbedMouse[widget] = nil
    local nextMouse = g_mouse.getActiveGrabberCursor()
    if nextMouse then
      g_mouse.applyNativeCursor(nextMouse)
    else
      g_mouse.restoreNativeCursor()
    end
  end
end

function g_mouse.clearGrabber()
  for widget, mouse in pairs(g_mouse.grabbedMouse) do
    if mouse ~= '' then
      g_mouse.popCursor(mouse)
    end
    widget:ungrabMouse()
  end
  g_mouse.grabbedMouse = {}
  g_mouse.restoreNativeCursor()
end
