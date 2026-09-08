-- ===== HELPER AUTO FOOD =====
-- Modulo separado para gerenciar o Auto Food Eating do Helper

-- Garante que _Helper existe (sera definido em helper.lua, mas pode ser carregado antes)
if not _Helper then
  _Helper = {}
end

_Helper.AutoFood = {}

-- ===== CONFIGURACOES LOCAIS =====

local foodConfig = { id = "food", exhaustion = 3000 }

local defaultFoodIds = {
  3577, 3578, 3579, 3581, 3582, 3583, 3585, 3586, 3587,
  3588, 3589, 3592, 3595, 3597, 3600, 3601, 3602, 3606,
  3607, 3723, 3724, 3725, 3728, 3731, 3732, 8011, 8014,
  8016, 8017, 12310, 14085, 17457, 17820, 17821, 21143,
  21144, 21146, 23535, 23545, 62069
}

local defaultInfiniteFoodIds = {
  61615, 61672, 61930, 62184, 62267, 62268, 63235, 63314,
  63723, 49702
}

local function getFoodIds()
  return FoodIds or defaultFoodIds
end

local function getInfiniteFoodIds()
  return InfiniteFoodIds or defaultInfiniteFoodIds
end



-- ===== FUNCOES DO AUTO FOOD =====

-- Toggle para habilitar/desabilitar o Auto Food
_Helper.AutoFood.toggle = function(checked)
  local helperConfig = _Helper.getHelperConfig and _Helper.getHelperConfig()
  if helperConfig then
    helperConfig.autoEatFood = checked
  end
  -- Salvar configuracao
  if _Helper.saveSettings then
    _Helper.saveSettings()
  end
end

-- Funcao principal que verifica e usa comida
_Helper.AutoFood.check = function()
  local helperConfig = _Helper.getHelperConfig and _Helper.getHelperConfig()
  if not g_game.isOnline() or not helperConfig or not helperConfig.autoEatFood then
    return
  end

  local getSpellCooldown = _Helper.getSpellCooldown
  if not getSpellCooldown then
    return
  end

  local cooldown = getSpellCooldown(foodConfig.id)
  if cooldown >= g_clock.millis() then
    return true
  end

  local currentPlayer = g_game.getLocalPlayer()
  if not currentPlayer then
    return
  end

  local safeDoThing = _Helper.safeDoThing
  local setSpellCooldown = _Helper.setSpellCooldown

  -- Prioridade: infinite food items
  for _, id in pairs(getInfiniteFoodIds()) do
    if currentPlayer:getInventoryCount(id) > 0 then
      if safeDoThing then safeDoThing(false) end
      g_game.useInventoryItem(id)
      if safeDoThing then safeDoThing(true) end
      if setSpellCooldown then
        setSpellCooldown(foodConfig.id, g_clock.millis() + foodConfig.exhaustion)
      end
      return
    end
  end

  -- Normal food items
  for _, id in pairs(getFoodIds()) do
    if currentPlayer:getInventoryCount(id) > 0 then
      if safeDoThing then safeDoThing(false) end
      g_game.useInventoryItem(id)
      if safeDoThing then safeDoThing(true) end
      if setSpellCooldown then
        setSpellCooldown(foodConfig.id, g_clock.millis() + foodConfig.exhaustion)
      end
      break
    end
  end
end

-- Reset do eatFood checkbox no UI
_Helper.AutoFood.resetCheckbox = function()
  local toolsPanel = _Helper.getToolsPanel and _Helper.getToolsPanel()
  if not toolsPanel then return end

  local eatFood = toolsPanel:recursiveGetChildById("eatFood")
  if eatFood then
    eatFood:setChecked(false)
  end
end

-- Carrega o estado do autoEatFood para o UI
_Helper.AutoFood.loadToUI = function()
  local helperConfig = _Helper.getHelperConfig and _Helper.getHelperConfig()
  local toolsPanel = _Helper.getToolsPanel and _Helper.getToolsPanel()
  if not helperConfig or not toolsPanel then return end

  local eatFood = toolsPanel:recursiveGetChildById("eatFood")
  if eatFood then
    eatFood:setChecked(helperConfig.autoEatFood or false)
  end
end

-- Getter para foodIds (caso outros modulos precisem)
_Helper.AutoFood.getFoodIds = function()
  return getFoodIds()
end

-- Getter para infiniteFoodIds (caso outros modulos precisem)
_Helper.AutoFood.getInfiniteFoodIds = function()
  return getInfiniteFoodIds()
end

-- Getter para foodConfig (caso outros modulos precisem)
_Helper.AutoFood.getFoodConfig = function()
  return foodConfig
end

-- ===== FIM HELPER AUTO FOOD =====
