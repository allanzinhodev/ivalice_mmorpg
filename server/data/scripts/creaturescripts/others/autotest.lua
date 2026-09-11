--[[
  Teleporta o personagem para um ponto de teste no login, e opcionalmente
  roda o teste automatico do JUMP.

  POR QUE ISTO EXISTE

  Validar o empilhamento e a agua exige o personagem EM CIMA deles, e nao ha
  como mandar teclas para o client OpenGL de fora: nem SendKeys nem
  PostMessage chegam a janela. Sem isto, cada validacao depende de alguem
  caminhar ate la a mao.

  So dispara com o arquivo-marcador presente:

    data/autotest.request     (conteudo: "x y", ex. "8 11")

  Sem ele o script nao faz nada. O destino sai do arquivo, entao da para
  mudar o alvo sem recompilar nem editar codigo.

  ATENCAO: o marcador e lido AQUI, no onLogin do SERVER. Trocar o arquivo e
  reiniciar so o client nao tem efeito nenhum -- duas capturas seguidas saem
  identicas e parecem dizer que a feature nao funciona. Reinicie o server.

  ALVOS UTEIS no mapa de teste (gen-map-test.js):
    8 8     nascimento, chao plano
    11 10   entre os dois degraus ABRUPTOS: o de altura 4 fica em (10,10)
            e o de altura 5 em (12,10). Com JUMP=4 o primeiro passa e o
            segundo barra. A rampa de (10,8) a (15,8) nao serve para isto:
            ela sobe de 1 em 1, entao qualquer JUMP >= 1 vence ela inteira.
    14 14   pilha de 12 niveis, para ver que nao ha teto
    8 11    agua, para a troca de patternZ

  TESTE DO JUMP

  Com o marcador extra `data/autotest.jump` presente, o script anda de
  verdade a partir de (11,10) e imprime o resultado no log do server.

  Anda de VERDADE: creature:move(direction) chama
  Game::internalMoveCreature(creature, direction, ...), que e onde a regra do
  JUMP vive. O FLAG_NOLIMIT que o binding passa NAO contorna a regra -- a
  checagem acontece antes de `flags` ser usado (game.cpp:1693-1704).

  E por isso que teleportTo nao serve aqui: ele vai direto para a outra
  sobrecarga, a que recebe o Tile, e essa nao tem a regra. Um teste por
  teleporte passaria sempre e nao provaria nada.
]]

local MARCADOR = 'data/autotest.request'
local MARCADOR_JUMP = 'data/autotest.jump'

local autotest = CreatureEvent("AutoTest")

--[[
  Anda um passo e diz se o resultado bate com o esperado.

  `esperado` e true quando o passo TEM que funcionar. Um teste que so checasse
  "nao deu erro" passaria mesmo com a regra do JUMP removida -- por isso o
  caso que tem que BARRAR vale tanto quanto o que tem que passar.
]]
local function passo(player, direcao, nome, esperado)
	local antes = player:getPosition()
	local ret = player:move(direcao)
	local depois = player:getPosition()
	local andou = not (antes.x == depois.x and antes.y == depois.y)

	local veredito = (andou == esperado) and 'OK   ' or 'FALHA'
	print(string.format(
		'[autotest-jump] %s %s: %s (%d,%d) -> (%d,%d), esperado %s, ret=%s',
		veredito, nome, andou and 'andou ' or 'barrou',
		antes.x, antes.y, depois.x, depois.y,
		esperado and 'andar' or 'barrar', tostring(ret)))

	return andou == esperado
end

local function testarJump(cid)
	local player = Player(cid)
	if not player then
		return
	end

	print('[autotest-jump] JUMP do personagem = ' .. tostring(player:getJump()))

	local ok = 0

	-- Sai de (11,10), chao plano entre os dois degraus abruptos.
	-- Oeste: (10,10) tem altura 4. Subida de 4, no limite do JUMP=4.
	player:teleportTo(Position(11, 10, 7))
	if passo(player, DIRECTION_WEST, 'subida de 4 (no limite)  ', true) then
		ok = ok + 1
	end

	-- Volta ao chao para o proximo caso comecar do mesmo lugar.
	-- Leste: (12,10) tem altura 5. Subida de 5, acima do JUMP=4.
	player:teleportTo(Position(11, 10, 7))
	if passo(player, DIRECTION_EAST, 'subida de 5 (acima dele)', false) then
		ok = ok + 1
	end

	print('[autotest-jump] RESULTADO: ' .. ok .. '/2')
end

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

	local jumpFile = io.open(MARCADOR_JUMP, 'r')
	local rodarJump = jumpFile ~= nil
	if jumpFile then
		jumpFile:close()
	end

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

	if rodarJump then
		-- Depois do teleporte, para o personagem ja estar posicionado.
		addEvent(testarJump, 1500, player:getId())
	end

	return true
end

autotest:register()
