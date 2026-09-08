-- ===== HELPER SMART FOLLOW =====
-- Follow inteligente baseado em autoWalk via onCreaturePositionChange
-- Nao usa g_game.follow() (que e cancelado por g_game.attack())
-- Usa autoWalk(adjPos) para seguir no mesmo andar (para 1 sqm do target)
-- Usa autoWalk(oldPos) para seguir entre andares (escada/hole)
-- Usa autoWalk(lastKnownTargetPos) quando perde de vista
-- Cancela walk em progresso para redirecionar imediatamente
-- So aceita party members como target
-- Estado mantido apenas em memoria (nao persiste em arquivo)
-- Hotkey persiste via helperConfig em helper.json

if not _Helper then
  _Helper = {}
end

_Helper.SmartFollow = {}

-- ===== ESTADO EM MEMORIA =====

local enabled = false
local targetCreature = nil     -- referencia direta ao creature
local targetCreatureName = nil -- nome para fallback (busca por nome)
local lastKnownTargetPos = nil -- ultima posicao conhecida do target
local targetVisible = false    -- flag para detectar transicao visivel -> perdeu de vista
local isLoadingUI = false
local cycleEvt = nil
local CYCLE_INTERVAL = 100       -- ciclo de fallback (ms)
local VISIBLE_CYCLE_COOLDOWN = 300 -- cooldown do ciclo quando target visivel (ms)
local LOST_SIGHT_COOLDOWN = 500    -- cooldown para autowalk quando perdeu de vista (ms)
local lastCycleWalkAttempt = 0     -- timestamp da ultima tentativa de autowalk (ciclo, target visivel)
local lastAutoWalkAttempt = 0      -- timestamp da ultima tentativa de autowalk (lost-sight)

-- ===== FUNCOES INTERNAS =====

local MAX_EXTRA_DISTANCE = 3  -- tenta ate +3 sqm alem do adjacente (1..4 sqm do target)

local function tileHasFloorChange(tile)
  return tile and tile.hasFloorChange and tile:hasFloorChange()
end
local PATHFIND_MAX_COMPLEXITY = 1000
local PATHFIND_FLAGS = 3  -- AllowNotSeenTiles(1) + AllowCreatures(2)

-- 8 direcoes ao redor do target (N, E, S, W, NE, SE, SW, NW)
local DIR_OFFSETS = {
  {0,-1}, {1,0}, {0,1}, {-1,0},
  {1,-1}, {1,1}, {-1,1}, {-1,-1}
}

-- Tenta autoWalk para posicao proxima ao target
-- Para cada distancia (1..4 sqm), testa TODAS as 8 direcoes ao redor do target
-- Ordena por proximidade ao player e usa g_map.findPath sincrono para validar
-- So chama autoWalk na primeira posicao com path valido (evita "There is no way.")
local function tryAutoWalkToTarget(localPlayer, targetPos, playerPos)
  local currentDist = math.max(math.abs(playerPos.x - targetPos.x), math.abs(playerPos.y - targetPos.y))
  if currentDist <= 1 then return true end

  local maxDist = math.min(1 + MAX_EXTRA_DISTANCE, currentDist - 1)
  for dist = 1, maxDist do
    -- Gera candidatos em todas as 8 direcoes a 'dist' sqm do target
    local candidates = {}
    for _, off in ipairs(DIR_OFFSETS) do
      local cx = targetPos.x + off[1] * dist
      local cy = targetPos.y + off[2] * dist
      local pdist = math.max(math.abs(playerPos.x - cx), math.abs(playerPos.y - cy))
      candidates[#candidates + 1] = { x = cx, y = cy, pdist = pdist }
    end
    -- Prioriza posicoes mais proximas do player (path mais curto)
    table.sort(candidates, function(a, b) return a.pdist < b.pdist end)

    for _, c in ipairs(candidates) do
      local pos = { x = c.x, y = c.y, z = targetPos.z }
      -- Rejeita tiles com floor-change (escada/hole)
      local tile = g_map.getTile(pos)
      if tile and not tileHasFloorChange(tile) then
      local ok, dirs = pcall(g_map.findPath, playerPos, pos, PATHFIND_MAX_COMPLEXITY, PATHFIND_FLAGS)
      if ok and dirs and #dirs > 0 then
        localPlayer:autoWalk(pos)
        return true
        end
      end
    end
  end
  return false
end

-- Busca creature por nome nos spectators visiveis
local function findCreatureByName(name)
  if not name or name == "" then return nil end
  local localPlayer = g_game.getLocalPlayer()
  if not localPlayer then return nil end

  local spectators = g_map.getSpectators(localPlayer:getPosition(), false)
  if not spectators then return nil end

  for _, creature in ipairs(spectators) do
    if creature:getName() == name and not creature:isLocalPlayer() then
      return creature
    end
  end
  return nil
end

-- Forward declaration
local smartFollowCheck

-- Inicia o ciclo periodico
local function startCycle()
  if cycleEvt then return end
  cycleEvt = cycleEvent(smartFollowCheck, CYCLE_INTERVAL)
end

-- Para o ciclo periodico
local function stopCycle()
  if cycleEvt then
    removeEvent(cycleEvt)
    cycleEvt = nil
  end
end

-- Ciclo periodico
smartFollowCheck = function()
  if not enabled then return end
  if not targetCreatureName or targetCreatureName == "" then return end
  if not g_game.isOnline() then return end

  local localPlayer = g_game.getLocalPlayer()
  if not localPlayer then return end
  local playerPos = localPlayer:getPosition()
  if not playerPos then return end

  -- Target visivel? Sempre atualizar posicao, independente de estar andando
  local found = findCreatureByName(targetCreatureName)
  if found then
    -- Validar se ainda e party member
    if not found:isPartyMember() then
      targetCreature = nil
      targetCreatureName = nil
      targetVisible = false
      lastKnownTargetPos = nil
      stopCycle()
      return
    end
    targetVisible = true
    targetCreature = found
    local targetPos = found:getPosition()
    if targetPos then
      -- lastKnownTargetPos = { x = targetPos.x, y = targetPos.y, z = targetPos.z }
    end
    -- autoWalk com cooldown no ciclo (evento ja reage imediato)
    local now = g_clock.millis()
    if now - lastCycleWalkAttempt >= VISIBLE_CYCLE_COOLDOWN and targetPos and playerPos.z == targetPos.z then
      local dx = math.abs(playerPos.x - targetPos.x)
      local dy = math.abs(playerPos.y - targetPos.y)
      if dx > 1 or dy > 1 then
        lastCycleWalkAttempt = now
        tryAutoWalkToTarget(localPlayer, targetPos, playerPos)
      end
    end
    return
  end

  -- Target nao visivel - detectar transicao
  if targetVisible then
    targetVisible = false
  end

  -- autowalk ate a ultima posicao conhecida (cancela walk atual se necessario)
  if lastKnownTargetPos then
    if playerPos.z == lastKnownTargetPos.z then
      local now = g_clock.millis()
      if now - lastAutoWalkAttempt >= LOST_SIGHT_COOLDOWN then
        lastAutoWalkAttempt = now
        localPlayer:autoWalk(lastKnownTargetPos)
      end
    end
  end
end

-- ===== FUNCOES PUBLICAS =====

-- Executa o toggle real do smart follow
local function doSmartFollowToggle(checked)
  -- Bloqueio mútuo: ao ligar smart follow, desligar cavebot
  if checked then
    if modules.game_helper and modules.game_helper.cavebot then
      if modules.game_helper.cavebot.isEnabled() then
        modules.game_helper.cavebot.doToggle(false)
      end
    end
  end

  enabled = checked

  -- Notify server about smart follow state change via Extended Opcode
  local protocolGame = g_game.getProtocolGame()
  if protocolGame then
    protocolGame:sendExtendedOpcode(ExtendedIds.SmartFollow, checked and "1" or "0")
  end

  -- Sync shortcut panel button
  if _Helper.Shortcut and _Helper.Shortcut.syncButton then
    _Helper.Shortcut.syncButton('shortcutFollow', checked)
  end

  if not checked then
    stopCycle()
  else
    if targetCreatureName and targetCreatureName ~= "" then
      lastAutoWalkAttempt = 0
      startCycle()
    end
  end
end

-- Toggle para habilitar/desabilitar o smart follow
_Helper.SmartFollow.toggle = function(checked)
  if isLoadingUI then return end

  -- Ao ativar, mostra aviso de checagem (se ainda não foi ocultado)
  if checked and _Helper.showToolWarning then
    _Helper.showToolWarning(
      function()
        doSmartFollowToggle(checked)
      end,
      function()
        -- Cancelou: reverter checkbox para desmarcado
        isLoadingUI = true
        local toolsPanel = _Helper.getToolsPanel and _Helper.getToolsPanel()
        if toolsPanel then
          local cb = toolsPanel:recursiveGetChildById("smartFollow")
          if cb then cb:setChecked(false) end
        end
        isLoadingUI = false
      end
    )
  else
    doSmartFollowToggle(checked)
  end
end

-- Retorna se esta habilitado
_Helper.SmartFollow.isEnabled = function()
  return enabled
end

-- Captura o creature alvo quando o player usa follow
-- Sempre captura, independente de enabled (player pode ativar depois)
-- So aceita party members
_Helper.SmartFollow.setTarget = function(creature)
  if not creature or creature:isLocalPlayer() then return end
  if not creature:isPartyMember() then return end

  targetCreature = creature
  targetCreatureName = creature:getName()
  targetVisible = true
  local pos = creature:getPosition()
  if not pos then return end
  lastKnownTargetPos = { x = pos.x, y = pos.y, z = pos.z }
  lastAutoWalkAttempt = 0

  if enabled then
    startCycle()
  end
end

-- Limpa o target (so chamado por onLogout/resetCheckbox/loadToUI)
_Helper.SmartFollow.clearTarget = function()
  stopCycle()
  targetCreature = nil
  targetCreatureName = nil
  targetVisible = false
  lastKnownTargetPos = nil
end

-- Retorna o creature alvo atual
_Helper.SmartFollow.getTarget = function()
  return targetCreature
end

-- Retorna o nome do creature alvo atual
_Helper.SmartFollow.getTargetName = function()
  return targetCreatureName
end

-- ===== EVENTO PRINCIPAL: onCreaturePositionChange =====
-- Conectado ao Creature (todas as criaturas) - filtra pelo target
-- Mesmo andar: autoWalk IMEDIATO para posicao adjacente ao target
-- Mudou de andar: autoWalk(oldPos) IMEDIATO (redirecionamento para escada)
_Helper.SmartFollow.onCreaturePositionChange = function(creature, newPos, oldPos)
  if not enabled then return end
  if not targetCreatureName or targetCreatureName == "" then return end
  if not creature or creature:isLocalPlayer() then return end
  if not newPos or not oldPos then return end
  if creature:getName() ~= targetCreatureName then return end
  if not g_game.isOnline() then return end

  targetCreature = creature
  targetVisible = true
  lastKnownTargetPos = { x = oldPos.x, y = oldPos.y, z = oldPos.z }

  local localPlayer = g_game.getLocalPlayer()
  if not localPlayer then return end
  local playerPos = localPlayer:getPosition()
  if not playerPos then return end

  if newPos.z ~= oldPos.z then
    -- MUDOU DE ANDAR: autoWalk ate oldPos (escada/hole) - IMEDIATO
    if playerPos.z == oldPos.z then
      lastAutoWalkAttempt = g_clock.millis()
      localPlayer:autoWalk(oldPos)
    end
  else
    -- MESMO ANDAR: autoWalk IMEDIATO para posicao adjacente ao target
    -- Se nao conseguir 1 sqm, tenta +1, +2... ate achar path
    if playerPos.z == newPos.z then
      local dx = math.abs(playerPos.x - newPos.x)
      local dy = math.abs(playerPos.y - newPos.y)
      if dx > 1 or dy > 1 then
        tryAutoWalkToTarget(localPlayer, newPos, playerPos)
      end
    end
  end
end

-- Chamada quando o LOCAL PLAYER muda de posicao
-- Apos mudar de andar, reset cooldown e check imediato
_Helper.SmartFollow.onLocalPlayerPositionChange = function(creature, newPos, oldPos)
  if not enabled then return end
  if not targetCreatureName or targetCreatureName == "" then return end
  if not newPos or not oldPos then return end
  if not g_game.isOnline() then return end

  if newPos.z ~= oldPos.z then
    lastAutoWalkAttempt = 0
    scheduleEvent(function()
      if not enabled then return end
      if not g_game.isOnline() then return end
      smartFollowCheck()
    end, 300)
  end
end

-- Reset do checkbox no UI
_Helper.SmartFollow.resetCheckbox = function()
  local toolsPanel = _Helper.getToolsPanel and _Helper.getToolsPanel()
  if not toolsPanel then return end

  isLoadingUI = true
  local checkbox = toolsPanel:recursiveGetChildById("smartFollow")
  if checkbox then
    checkbox:setChecked(false)
  end
  isLoadingUI = false

  stopCycle()
  enabled = false

  -- Sync shortcut panel button
  if _Helper.Shortcut and _Helper.Shortcut.syncButton then
    _Helper.Shortcut.syncButton('shortcutFollow', false)
  end

  -- Notify server about smart follow disabled
  local protocolGame = g_game.getProtocolGame()
  if protocolGame then
    protocolGame:sendExtendedOpcode(ExtendedIds.SmartFollow, "0")
  end
end

-- Carrega estado no UI (como nao persiste, so reseta)
_Helper.SmartFollow.loadToUI = function()
  local toolsPanel = _Helper.getToolsPanel and _Helper.getToolsPanel()
  if not toolsPanel then return end

  isLoadingUI = true
  local checkbox = toolsPanel:recursiveGetChildById("smartFollow")
  if checkbox then
    checkbox:setChecked(false)
  end
  isLoadingUI = false

  stopCycle()
  enabled = false
end

-- Cleanup ao deslogar
_Helper.SmartFollow.onLogout = function()
  stopCycle()
  enabled = false
  targetCreature = nil
  targetCreatureName = nil
  targetVisible = false
  lastKnownTargetPos = nil
  lastAutoWalkAttempt = 0
end

-- ===== FIM HELPER SMART FOLLOW =====
