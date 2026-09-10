--[[
  Confere o datapack usando o CAMINHO DE CODIGO REAL do client, e sai.

  POR QUE ISTO EXISTE

  tools/asset-compiler/render-check.js compara duas compilacoes, mas compara
  um modelo em JS contra outro modelo em JS. Ele prova que o compilador e
  coerente consigo mesmo -- nao prova que o CLIENT le o que foi escrito.

  A diferenca importa porque o client tem dois trechos que o JS nao alcanca:

    SpriteManager::loadCwmSpr        -- le o .cwm e desempacota os PNGs
    ThingType::getTexture            -- monta o atlas de textura

  E o segundo falha em SILENCIO. getBestTextureDimension usa VALIDATE, que em
  release (NDEBUG) vira `((void)0)` -- ou seja, um atlas pequeno demais nao
  levanta erro nenhum, so devolve arte cortada. Nao da para testar isso
  esperando uma excecao; e preciso olhar o RESULTADO.

  COMO USAR

    touch client/data/assetcheck.request
    ./client/otclient_gl_x64.exe

  Sem o arquivo-marcador o modulo nao faz nada. Com ele, o client carrega o
  datapack, despeja as folhas, escreve o relatorio e fecha.

  Saida (no write dir do client, que o relatorio informa):
    assetcheck.txt              uma linha por thing
    assetcheck-<cat>-<id>.png   folha montada por ThingType::exportImage
]]

local MARCADOR = '/assetcheck.request'
local RELATORIO = '/assetcheck.txt'

-- Categorias, de ThingType::ThingCategory (client/src/client/thingtype.h).
local CAT_ITEM = 0
local CAT_CREATURE = 1

-- O que despejar como PNG. O resto entra so no relatorio, para o arquivo nao
-- virar centenas de imagens.
local DESPEJAR = {
  { cat = CAT_CREATURE, id = 1 },
  { cat = CAT_ITEM, id = 100 },
  { cat = CAT_ITEM, id = 101 },
}

local linhas = {}

local function anotar(fmt, ...)
  local linha = string.format(fmt, ...)
  table.insert(linhas, linha)
  g_logger.info('[assetcheck] ' .. linha)
end

--[[
  Carrega o datapack pela MESMA porta que o jogo usa.

  A primeira versao disto chamava g_things.loadDat/g_sprites.loadSpr na mao, e
  errou duas vezes seguidas pelo mesmo motivo: reproduzir a preparacao do
  client e mais dificil do que parece.

    1. Sem g_game.setClientVersion, ThingType::unserialize nao le o campo
       numPatternZ (so o le com versao >= 755), o stream desalinha e o
       loadDat falha longe da causa.
    2. Com setClientVersion, o tiro sai pela culatra: ele dispara
       onClientVersionChange, e no meio da carga dos modulos isso e erro
       fatal.

  A licao e que a preparacao pertence a game_things, e duplica-la aqui so
  cria um segundo caminho para manter em dia -- que testaria justamente o que
  ele mesmo faz, e nao o que o jogo faz. Entao chamamos game_things.load().
]]
local function carregarDatapack()
  -- game_things nao tem autoload: quem o carrega e o client_entergame, na
  -- hora de entrar. Como aqui nao se entra no jogo, carregamos na mao.
  g_modules.ensureModuleLoaded('game_things')

  local gameThings = modules.game_things
  if not gameThings then
    anotar('ERRO: modulo game_things ausente mesmo apos ensureModuleLoaded')
    return false
  end

  gameThings.load()

  if not gameThings.isLoaded() then
    anotar('ERRO: game_things.load() nao carregou o datapack')
    return false
  end

  -- spriteSize sozinho ja identifica o loader: o .spr classico crava 32
  -- (spritemanager.cpp:70), entao qualquer outro valor so pode ter vindo do
  -- .cwm, que le o tamanho de dentro do arquivo.
  anotar('spriteSize=%d', g_sprites.spriteSize())
  return true
end

local function conferir(cat, id, despejar)
  local t = g_things.getThingType(id, cat)
  if not t then
    anotar('cat=%d id=%d  AUSENTE', cat, id)
    return
  end

  --[[
    getExactSize e o que prova o atlas.

    Ele chama getTexture(0), que monta a textura de verdade, e depois mede o
    retangulo OPACO dentro dela. Se o atlas tivesse sido dimensionado pelo
    caminho antigo (teto = spriteSize, que com 8x8 daria 8 sprites por eixo),
    a arte sairia cortada e este numero encolheria -- sem erro nenhum.
  ]]
  local ok, exact = pcall(function() return t:getExactSize() end)
  anotar('cat=%d id=%-4d  %dx%d celulas  exactSize=%s',
    cat, id, t:getWidth(), t:getHeight(), ok and tostring(exact) or ('ERRO: ' .. tostring(exact)))

  if despejar then
    local arquivo = string.format('/assetcheck-%d-%d.png', cat, id)
    local ok2, err = pcall(function() t:exportImage(arquivo) end)
    if ok2 then
      anotar('  despejado %s', arquivo)
    else
      anotar('  ERRO ao despejar: %s', tostring(err))
    end
  end
end

local function rodar()
  anotar('write dir: %s', g_resources.getWriteDir())

  if carregarDatapack() then
    for _, alvo in ipairs(DESPEJAR) do
      conferir(alvo.cat, alvo.id, true)
    end
    -- uma amostra mais larga, so no relatorio
    for id = 102, 130 do
      conferir(CAT_ITEM, id, false)
    end
    for id = 2, 4 do
      conferir(CAT_CREATURE, id, false)
    end
  end

  g_resources.writeFileContents(RELATORIO, table.concat(linhas, '\n') .. '\n')
  scheduleEvent(function() g_app.exit() end, 100)
end

function init()
  if not g_resources.fileExists(MARCADOR) then
    return
  end

  -- Adiado de proposito: `modules.game_things` so existe depois que todos os
  -- modulos carregaram, e mexer no estado do jogo dentro de um @onLoad e
  -- erro fatal.
  scheduleEvent(rodar, 500)
end
