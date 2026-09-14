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

local gravando = false
local rotulo = "dump"
local contador = 0
local callbackId = nil

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

local function escreverRegiao(destino, reg)
  local f = io.open(destino .. "/" .. reg.nome, "wb")
  if not f then
    console:error("nao consegui abrir " .. destino .. "/" .. reg.nome)
    return false
  end

  -- readRange devolve a faixa inteira de uma vez. Ler 32 KB byte a byte a
  -- cada frame travaria o emulador -- sao 2 milhoes de chamadas por segundo.
  f:write(emu:readRange(reg.base, reg.tam))
  f:close()
  return true
end

local function despejar()
  if not gravando then return end

  contador = contador + 1
  if contador % PASSO ~= 0 then return end

  local destino = string.format("%s/%s-%04d", PASTA, rotulo, contador)
  criarPasta(destino)

  for _, reg in ipairs(REGIOES) do
    if not escreverRegiao(destino, reg) then
      gravando = false
      console:error("gravacao interrompida")
      return
    end
  end

  if contador % 30 == 0 then
    console:log("frame " .. contador .. " -> " .. destino)
  end
end

--- Comeca a gravar. `nome` vira o prefixo das pastas.
function iniciar(nome)
  rotulo = nome or "dump"
  contador = 0
  gravando = true
  criarPasta(PASTA)
  console:log("gravando em " .. PASTA .. "/" .. rotulo .. "-NNNN  (passo " .. PASSO .. ")")
  console:log("execute a habilidade agora; depois digite  parar()")
end

--- Para de gravar.
function parar()
  gravando = false
  console:log("parado. " .. contador .. " frames capturados.")
  console:log("agora rode:  node tools/ffta-vram/varrer.js " .. PASTA)
end

callbackId = callbacks:add("frame", despejar)

console:log("dump-frames.lua carregado.")
console:log("  iniciar(\"nome\")  comeca a gravar")
console:log("  parar()          termina")
