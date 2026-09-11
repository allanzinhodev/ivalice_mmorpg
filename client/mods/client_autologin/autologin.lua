--[[
  Loga sozinho com a conta de teste (1/1).

  POR QUE ISTO EXISTE

  Validar o mapa exige estar DENTRO do jogo, e SendKeys nao alcanca o client
  OpenGL -- as teclas nao chegam a janela. Sem isso, cada rodada de
  "compila, sobe, olha a tela" trava na tela de login esperando alguem
  digitar.

  So dispara com o arquivo-marcador presente:

    client/data/autologin.request

  Sem ele o modulo nao faz nada, entao nao atrapalha o uso normal.

  NAO E CREDENCIAL DE PRODUCAO: 1/1 e a conta de teste que o schema.sql
  semeia, num server local. Se algum dia isto rodar contra outro servidor, o
  marcador nao deve existir.
]]

local MARCADOR = '/data/autologin.request'
local CONTA = '1'
local SENHA = '1'

local evento = nil

local function tentarLogar()
  evento = nil

  if g_game.isOnline() then
    return
  end

  -- Ja autenticou e esta na selecao de personagem: entra com o primeiro.
  -- CharacterList.doLogin usa o que estiver selecionado, e a lista ja vem
  -- com o primeiro marcado.
  if CharacterList and CharacterList.isVisible and CharacterList.isVisible() then
    CharacterList.doLogin()
    return
  end

  -- EnterGame e a tabela de funcoes do modulo, nao a janela. doLogin recebe
  -- conta e senha direto, entao nao e preciso mexer nos campos da UI.
  if not EnterGame or not EnterGame.doLogin then
    -- O modulo de login ainda nao carregou; tenta de novo.
    evento = scheduleEvent(tentarLogar, 500)
    return
  end

  local host = g_settings.get('host')
  if host == nil or host == '' then
    host = '127.0.0.1:7171'
  end

  EnterGame.doLogin(CONTA, SENHA, '', host)

  -- Continua tentando: doLogin so autentica, e depois vem a selecao de
  -- personagem. O laco acima trata esse segundo passo quando a lista
  -- aparecer, e para sozinho assim que g_game.isOnline().
  evento = scheduleEvent(tentarLogar, 1500)
end

function init()
  if not g_resources.fileExists(MARCADOR) then
    return
  end

  g_logger.info('[autologin] marcador presente, logando como ' .. CONTA)
  -- Espera o client terminar de subir os modulos antes de mexer na janela.
  evento = scheduleEvent(tentarLogar, 1500)
end

function terminate()
  if evento then
    removeEvent(evento)
    evento = nil
  end
end
