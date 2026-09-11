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
    11 10   entre os dois degraus ABRUPTOS: o de altura 4 fica em (10,10)
            e o de altura 5 em (12,10). Com JUMP=4 o primeiro passa e o
            segundo barra. A rampa de (10,8) a (15,8) nao serve para isto:
            ela sobe de 1 em 1, entao qualquer JUMP >= 1 vence ela inteira.
    14 14   pilha de 12 niveis, para ver que nao ha teto
    8 11    agua, para o zPattern 2
]]

local MARCADOR = 'data/autotest.request'

local autotest = CreatureEvent("AutoTest")

function autotest.onLogin(player)
	local f = io.open(MARCADOR, 'r')
	if not f then
		print('[autotest] sem marcador em ' .. MARCADOR .. ', nada a fazer')
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

	--[[
	  O JUMP nao da para testar daqui.

	  teleportTo IGNORA Game::internalMoveCreature, que e onde a regra vive --
	  um teste por teleporte passaria sempre e nao provaria nada. E
	  player:move() nao existe no Lua deste fork.

	  Fica para validacao manual: com JUMP=4, andando de (11,10) para
	  (10,10) -- degrau de 4 -- tem que PASSAR, e para (12,10) -- degrau de
	  5 -- tem que BARRAR.
	]]
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
