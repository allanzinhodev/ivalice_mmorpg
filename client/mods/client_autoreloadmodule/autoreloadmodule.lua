local reloadEvents = {}
local otmlReloadEvent = nil
local datapackReloadEvent = nil

local function stopReloadEvents()
    if otmlReloadEvent then
        removeEvent(otmlReloadEvent)
        otmlReloadEvent = nil
    end

    if datapackReloadEvent then
        removeEvent(datapackReloadEvent)
        datapackReloadEvent = nil
    end

    for _, event in ipairs(reloadEvents) do
        removeEvent(event)
    end
    reloadEvents = {}
end

-- Recarrega Tibia.dat/.spr ao vivo.
--
-- O reload de modulos abaixo nunca alcanca isso: game_things e
-- `reloadable: false` (things.otmod), e e justamente ele quem carrega o
-- datapack. Sem isto, cada ajuste de displacement no Object Builder exige
-- reabrir o client.
--
-- Recarregar em runtime e seguro porque nenhum Thing cacheia o ThingType:
-- Item::rawGetThingType() (item.cpp:624) consulta o g_things a cada chamada,
-- entao os itens ja no mapa passam a enxergar os ThingTypes novos sozinhos.
local function liveDatapackReload()
    local base = '/data/things/860/Tibia'
    local watched = { base .. '.dat', base .. '.spr', base .. '.otfi' }

    local times = {}
    for _, path in ipairs(watched) do
        times[path] = g_resources.getFileTime(path)
    end

    -- O Object Builder escreve o arquivo em varios passos. Recarregar no
    -- primeiro tick em que o mtime muda pega o arquivo pela metade -- e um
    -- .spr truncado derruba o parse. Por isso so recarregamos depois que os
    -- mtimes PARARAM de mudar por um ciclo inteiro.
    local settling = false

    return cycleEvent(function()
        local changed = false
        for _, path in ipairs(watched) do
            local newtime = g_resources.getFileTime(path)
            if newtime ~= times[path] then
                times[path] = newtime
                changed = true
            end
        end

        if changed then
            settling = true
            return
        end

        if settling then
            settling = false
            pinfo('Reloading datapack (Tibia.dat/.spr)')
            modules.game_things.load()
        end
    end, 1000)
end

function init()
    if not AUTO_RELOAD_MODULE then
        return
    end

    stopReloadEvents()

    for _, module in ipairs(g_modules.getModules()) do
        local event = live_module_reload(module)
        if event then
            reloadEvents[#reloadEvents + 1] = event
        end
    end

    datapackReloadEvent = liveDatapackReload()

    local otmlPath = '/data/game.otml';
    local otmlTime = g_resources.getFileTime(otmlPath)

    -- otml auto reload
    otmlReloadEvent = cycleEvent(function()
        local newtime = g_resources.getFileTime(otmlPath)
        if newtime > otmlTime then
            pinfo('Reloading Game OTML')
            g_things.loadOtml(otmlPath)
            otmlTime = newtime
        end
    end, 1000)
end

function terminate()
    stopReloadEvents()
end

function live_module_reload(module)
    if not module:isReloadble() or not module:canReload() then
        return
    end

    local name = module:getName()

    local files = {}
    local hasFile = false
    for _, file in pairs(g_resources.listDirectoryFiles('/' .. name, true, false, true)) do
        local time = g_resources.getFileTime(file)
        if time > 0 then
            files[file] = time
            hasFile = true
        end
    end

    if not hasFile then
        -- Sem arquivo em disco (modulo empacotado): nao da para vigiar mtime. Nao e
        -- erro -- logar como ERROR a cada abertura so ensina a ignorar erro real.
        pinfo('autoreload: sem arquivos em disco, nao vigiado: ' .. name)
        return
    end

    return cycleEvent(function()
        for filepath, time in pairs(files) do
            local newtime = g_resources.getFileTime(filepath)
            if newtime > time then
                pinfo('Reloading ' .. name)
                modules.client_terminal.flushLines()
                module:reload()
                files[filepath] = newtime

                if name == 'client_terminal' then
                    modules.client_terminal.show()
                end
                break
            end
        end
    end, 1000)
end
