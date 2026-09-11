--[[
  Mede o custo de um passo em cada uma das 8 direcoes e compara com a
  distancia que esse passo percorre NA TELA.

  POR QUE ISTO IMPORTA

  O client interpola o passo como fracao 0..1 do tempo
  (Creature::updateWalkOffset), entao a velocidade que se ve e
  `distancia na tela / duracao do passo`. Se as duas nao andarem juntas, a
  caminhada fica visivelmente irregular conforme a direcao.

  Na grade ortogonal do Tibia a diagonal e sempre sqrt(2) mais longa que a
  reta, e por isso o TFS dobra a duracao dela
  (Creature::getStepDuration: `if diagonal then stepDuration *= 2`).

  Na projecao isometrica isso NAO vale: um passo diagonal pode ser mais
  longo OU mais curto que um reto, dependendo de qual diagonal.

  So dispara com o marcador `data/autotest.dirs`.
]]

local MARCADOR = 'data/autotest.dirs'

local ev = CreatureEvent("AutoTestDirs")

-- HW/HH da projecao (client/src/client/const.h).
local HW, HH = 16, 8

local DIRS = {
	{ DIRECTION_NORTH,     'norte    ',  0, -1 },
	{ DIRECTION_SOUTH,     'sul      ',  0,  1 },
	{ DIRECTION_EAST,      'leste    ',  1,  0 },
	{ DIRECTION_WEST,      'oeste    ', -1,  0 },
	{ DIRECTION_NORTHEAST, 'nordeste ',  1, -1 },
	{ DIRECTION_NORTHWEST, 'noroeste ', -1, -1 },
	{ DIRECTION_SOUTHEAST, 'sudeste  ',  1,  1 },
	{ DIRECTION_SOUTHWEST, 'sudoeste ', -1,  1 },
}

-- Area plana e livre no mapa de teste.
local BASE = Position(8, 16, 7)

local function medir(cid)
	local p = Player(cid)
	if not p then
		return
	end

	print('[autotest-dirs] speed=' .. tostring(p:getSpeed()))
	print('[autotest-dirs] direcao     andou  dur(ms)  dist(px)   px/s')

	local velocidades = {}

	for _, d in ipairs(DIRS) do
		local dir, nome, dc, dr = d[1], d[2], d[3], d[4]
		p:teleportTo(BASE)

		-- Pergunta ao SERVER, nao recalcula: um teste que reimplementa a
		-- formula mede a copia e continua passando depois de o C++ mudar.
		local dur = p:getStepDuration(dir)

		local antes = p:getPosition()
		p:move(dir)
		local depois = p:getPosition()
		local andou = not (antes.x == depois.x and antes.y == depois.y)

		-- Distancia na tela pela projecao isometrica.
		local dx = (dc - dr) * HW
		local dy = (dc + dr) * HH
		local dist = math.sqrt(dx * dx + dy * dy)
		local vel = dur > 0 and (dist * 1000 / dur) or 0

		if andou then
			velocidades[#velocidades + 1] = vel
		end

		print(string.format('[autotest-dirs] %s   %s   %6.0f   %6.1f  %6.1f',
			nome, andou and 'sim' or 'NAO', dur, dist, vel))
	end

	-- Uniformidade: quanto a mais rapida supera a mais lenta.
	local menor, maior = math.huge, 0
	for _, v in ipairs(velocidades) do
		if v < menor then menor = v end
		if v > maior then maior = v end
	end

	if menor < math.huge and menor > 0 then
		print(string.format(
			'[autotest-dirs] mais lenta %.1f px/s, mais rapida %.1f px/s -- razao %.2fx',
			menor, maior, maior / menor))
		print('[autotest-dirs] uniforme? ' ..
			((maior / menor) <= 1.05 and 'SIM' or 'NAO'))
	end
end

function ev.onLogin(player)
	local f = io.open(MARCADOR, 'r')
	if not f then
		return true
	end
	f:close()

	addEvent(medir, 2500, player:getId())
	return true
end

ev:register()
