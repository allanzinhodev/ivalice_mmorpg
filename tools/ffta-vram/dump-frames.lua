-- dump-frames.lua -- despeja VRAM/paleta/OAM a cada N frames, de dentro do mGBA.
--
--   mGBA 0.10+  ->  Tools > Scripting... > File > Load script
--
-- POR QUE ISTO EXISTE
--
-- Sprite de unidade da para pegar pausando a batalha: o personagem fica na
-- tela o tempo que voce quiser. Efeito de habilidade nao -- ele dura poucos
-- frames e some. Acertar o Save Range no frame certo, a mao, e sorte.
--
-- Este script tira a sorte da jogada: liga a gravacao, executa a habilidade,
-- desliga. Sai uma sequencia de despejos, um por frame, e o frame do efeito
-- esta la em algum lugar.
--
-- COMO USAR
--
--   1. Carregue a ROM e entre numa batalha.
--   2. Carregue este script (Tools > Scripting... > File > Load script).
--   3. No console do script, digite:  iniciar("cure")
--   4. Execute a habilidade no jogo.
--   5. Quando o efeito acabar:       parar()
--
-- Depois, no terminal:
--
--   node tools/ffta-vram/vram-rip.js <PASTA>/cure-0042
--
-- Cada subpasta e um frame. Rode o vram-rip nas que interessarem, ou use
-- varrer.js para processar todas de uma vez.

-- Onde gravar. Ajuste se quiser outro lugar.
local PASTA = "D:/ivalice/tools/ffta-vram/dumps"

-- De quantos em quantos frames despejar. 1 = todo frame (mais pesado, nao
-- perde nada). 2 ou 3 servem para efeito longo.
local PASSO = 1

-- Enderecos do GBA. NAO sao os do DS -- a OBJ VRAM aqui tem 32 KB, nao 256.
local REGIOES = {
  { nome = "palette.bin", base = 0x05000000, tam = 1024 },
  { nome = "objvram.bin", base = 0x06010000, tam = 32768 },
  { nome = "oam.bin",     base = 0x07000000, tam = 1024 },
}

-- Teto de frames guardados. 300 frames = ~10 MB de RAM, e 5 segundos de
-- animacao a 60fps -- de sobra para qualquer golpe.
local MAX_FRAMES = 300

local gravando = false
local rotulo = "dump"
local contador = 0
local callbackId = nil

--[[
  Os frames ficam na MEMORIA ate o parar().

  A primeira versao gravava em disco dentro do callback de frame, e isso
  derrubou o emulador de 60 para 0,4 fps: sao tres arquivos e 34 KB por
  frame, sessenta vezes por segundo, e o disco nao acompanha. O jogo
  engasgou depois de 22 frames.

  Acumular em RAM e gravar de uma vez no fim resolve: o callback so copia
  bytes, que e barato, e a escrita acontece uma vez so com o jogo parado.
]]
local buffer = {}

-- Ultima OBJ VRAM vista, para nao guardar copia do que nao mudou.
local ultimaVram = nil
local trocas = 0

--[[
  Cria a pasta.

  os.execute("mkdir") abriria uma janela de console A CADA FRAME no Windows --
  com PASSO=1 isso e uma janela piscando 60 vezes por segundo, e o emulador
  engasga. Tentar abrir um arquivo dentro da pasta diz se ela existe, e so
  chamamos o mkdir quando de fato falta.
]]
local pastasFeitas = {}
local function criarPasta(caminho)
  if pastasFeitas[caminho] then return end
  local teste = io.open(caminho .. "/.ok", "wb")
  if teste then
    teste:close()
    os.remove(caminho .. "/.ok")
  else
    os.execute('mkdir "' .. caminho:gsub("/", "\\") .. '" >nul 2>nul')
  end
  pastasFeitas[caminho] = true
end

--[[
  Callback de frame: so LE e guarda. Nada de disco aqui.

  readRange devolve a faixa inteira de uma vez -- ler 32 KB byte a byte
  seriam 2 milhoes de chamadas por segundo.
]]
local function despejar()
  if not gravando then return end

  contador = contador + 1
  if contador % PASSO ~= 0 then return end

  -- Ao bater o teto, so para de acumular. Nao chama parar() daqui: gravar
  -- 300 pastas de dentro do callback de frame e exatamente o que travou a
  -- primeira versao.
  if #buffer >= MAX_FRAMES then
    gravando = false
    console:log("teto de " .. MAX_FRAMES .. " frames atingido -- digite parar() para gravar")
    return
  end

  --[[
    A OAM e a paleta sao 1 KB cada; a OBJ VRAM e 32 KB -- 94% do custo.

    Numa animacao a VRAM costuma repetir de um frame para o outro: o que
    muda e a OAM, que reposiciona os mesmos tiles. Entao so guardamos a VRAM
    quando ela realmente mudou, e os demais frames referenciam a ultima.

    Isso derruba o custo por frame de 34 KB para ~2 KB na maioria deles.
  ]]
  local oam = emu:readRange(0x07000000, 1024)
  local pal = emu:readRange(0x05000000, 1024)
  local vram = emu:readRange(0x06010000, 32768)

  --[[
    Compara por igualdade direta. readRange devolve string Lua, e string em
    Lua e imutavel e internada -- `==` compara conteudo, nao referencia.

    Se um dia devolver userdata, esta comparacao vira sempre falsa e o
    script simplesmente guarda todo frame: fica mais pesado, mas nao perde
    dado nem quebra.
  ]]
  local igual = (ultimaVram ~= nil and vram == ultimaVram)
  if not igual then
    ultimaVram = vram
    -- Avisa em tempo real. Se voce executar o golpe e NADA aparecer aqui, a
    -- captura nao pegou a animacao -- melhor descobrir agora que depois de
    -- processar 300 frames.
    trocas = trocas + 1
    if trocas <= 40 then
      console:log("  VRAM mudou no frame " .. #buffer + 1)
    end
  end

  buffer[#buffer + 1] = {
    palette = pal,
    oam = oam,
    objvram = igual and false or vram,   -- false = "repete a anterior"
  }
end

--- Comeca a gravar. `nome` vira o prefixo das pastas.
function iniciar(nome)
  rotulo = nome or "dump"
  contador = 0
  buffer = {}
  ultimaVram = nil
  trocas = 0
  gravando = true
  console:log("gravando na memoria (ate " .. MAX_FRAMES .. " frames, passo " .. PASSO .. ")")
  console:log("execute a habilidade agora; depois digite  parar()")
end

--- Para de gravar e grava tudo em disco.
function parar()
  gravando = false

  if #buffer == 0 then
    console:log("nada capturado.")
    return
  end

  console:log("gravando " .. #buffer .. " frames em disco...")
  criarPasta(PASTA)

  local gravados = 0
  local vramAtual = nil

  for i, q in ipairs(buffer) do
    local destino = string.format("%s/%s-%04d", PASTA, rotulo, i)
    criarPasta(destino)

    -- objvram == false quer dizer "igual ao frame anterior". Expandimos aqui
    -- para que cada pasta fique completa e o vram-rip.js nao precise saber
    -- desta otimizacao.
    if q.objvram then vramAtual = q.objvram end

    local falhou = false
    for nome, dados in pairs({ ["palette.bin"] = q.palette,
                               ["objvram.bin"] = vramAtual,
                               ["oam.bin"] = q.oam }) do
      local f = io.open(destino .. "/" .. nome, "wb")
      if f then
        f:write(dados)
        f:close()
      else
        falhou = true
      end
    end

    if not falhou then gravados = gravados + 1 end
  end

  buffer = {}
  console:log("pronto: " .. gravados .. " frames em " .. PASTA)
  console:log("agora rode:  node tools/ffta-vram/varrer.js tools/ffta-vram/dumps")
end

callbackId = callbacks:add("frame", despejar)

console:log("dump-frames.lua carregado.")
console:log("  iniciar(\"nome\")  comeca a gravar")
console:log("  parar()          termina")
