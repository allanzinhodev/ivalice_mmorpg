--[[
  Teleporta o personagem para um ponto de teste no login.

  POR QUE ISTO EXISTE

  Validar o empilhamento e a agua exige o personagem EM CIMA deles, e nao ha
  como mandar teclas para o client OpenGL de fora: nem SendKeys nem
  PostMessage chegam a janela. Sem isto, cada validacao depende de alguem
  caminhar ate la a mao.

  So dispara com o arquivo-marcador presente:

    data/autotest.request     (conteudo: "x y", ex. "13 8")

  Sem ele o script nao faz nada. O destino sai do arquivo, entao da para
  mudar o alvo sem recompilar nem editar codigo.

  ALVOS UTEIS no mapa de teste (gen-map-test.js):
    8 8     nascimento, chao plano
    13 8    degrau de 4 niveis -- o limite do JUMP=4
    14 8    degrau de 5 -- deve BARRAR a subida vindo do 13
    12 12   pilha de 12 niveis, para ver que nao ha teto
    8 11    agua, para o zPattern 2
]]

local MARCADOR = 'data/autotest.request'

local autotest = CreatureEvent("AutoTest")

function autotest.onLogin(player)
	local f = io.open(MARCADOR, 'r')
	if not f then
		return true
	end

	local linha = f:read('*l')
	f:close()

	if not linha then
		return true
	end

	local x, y = linha:match('(%d+)%s+(%d+)')
	if not x or not y then
		print('[autotest] marcador invalido, esperava "x y": ' .. tostring(linha))
		return true
	end

	local destino = Position(tonumber(x), tonumber(y), 7)
	-- addEvent porque teleportar DENTRO do onLogin acontece antes de o client
	-- receber o mapa; o player aparece no lugar certo mas a tela fica na
	-- posicao antiga ate o primeiro passo.
	addEvent(function(cid, pos)
		local p = Player(cid)
		if p then
			p:teleportTo(pos)
			print('[autotest] ' .. p:getName() .. ' -> ' .. pos.x .. ',' .. pos.y)
		end
	end, 500, player:getId(), destino)

	return true
end

autotest:register()
