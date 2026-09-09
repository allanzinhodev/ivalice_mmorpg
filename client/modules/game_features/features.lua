function init()
  connect(g_game, { onClientVersionChange = updateFeatures })
end

function terminate()
  disconnect(g_game, { onClientVersionChange = updateFeatures })
end

function updateFeatures(version)
  g_game.resetFeatures()
  if version <= 0 then
    return
  end

  if version == 860 then
    g_game.enableFeature(GameLooktypeU16)
    g_game.enableFeature(GameMessageStatements)
    g_game.enableFeature(GameLoginPacketEncryption)
    g_game.enableFeature(GamePlayerAddons)
    g_game.enableFeature(GamePlayerStamina)
    g_game.enableFeature(GameNewFluids)
    g_game.enableFeature(GameMessageLevel)
    g_game.enableFeature(GamePlayerStateU16)
    g_game.enableFeature(GameNewOutfitProtocol)
    g_game.enableFeature(GameWritableDate)
    g_game.enableFeature(GameProtocolChecksum)
    g_game.enableFeature(GameAccountNames)
    g_game.enableFeature(GameDoubleFreeCapacity)
    g_game.enableFeature(GameChallengeOnLogin)
    g_game.enableFeature(GameMessageSizeCheck)
    g_game.enableFeature(GameTileAddThingWithStackpos)
    g_game.enableFeature(GameCreatureEmblems)

    -- TFS 1.8 8.60 Astra extensions.
    g_game.enableFeature(GameAttackSeq)
    g_game.enableFeature(GameBot)
    g_game.enableFeature(GameExtendedOpcode)
    g_game.enableFeature(GameSkillsBase)
    g_game.enableFeature(GamePlayerMounts)
    g_game.enableFeature(GameMagicEffectU16)
    g_game.enableFeature(GameDistanceEffectU16)
    g_game.enableFeature(GameDoubleHealth)
    g_game.enableFeature(GameOfflineTrainingTime)
    g_game.enableFeature(GameBaseSkillU16)
    g_game.enableFeature(GameAdditionalSkills)
    g_game.enableFeature(GameIdleAnimations)
    g_game.enableFeature(GameEnhancedAnimations)
    g_game.enableFeature(GameExtendedClientPing)

    -- Desenha TODO o chao antes de qualquer criatura/item.
    --
    -- Obrigatorio na projecao isometrica. Sem isto, MapView::drawFloor faz uma
    -- passada unica por tile (chao, itens, criaturas, topo) na ordem das
    -- diagonais, ou seja por `col + row` crescente. O tile ao SUL tem
    -- `col + row` maior, entao e desenhado DEPOIS -- e como o sprite de chao
    -- aqui e um bloco 32x32 estilo FFTA, cuja face de cima invade o espaco do
    -- tile de tras, ele passa por cima do personagem que esta no tile ao norte.
    --
    -- No Tibia isso nunca aparecia porque o chao e um quadrado chato que nao
    -- invade a celula vizinha. E o losango que cria o problema.
    --
    -- Com a feature ligada, drawFloor faz duas passadas: todo o chao primeiro,
    -- depois itens/criaturas/topo -- estes ainda na ordem das diagonais, entao
    -- a oclusao ENTRE eles continua correta. So o chao deixa de ocluir.
    g_game.enableFeature(GameMapDrawGroundFirst)
    g_game.enableFeature(GameSpritesU32)
    g_game.enableFeature(GameDoublePlayerGoodsMoney)
    g_game.enableFeature(GameCreatureIcons)
    g_game.enableFeature(GameColorizedLootValue)
    g_game.enableFeature(GameBrowseField)
    -- Astra 8.60 extends the outfit packet with familiar data.
    -- The server also negotiates this for non-hardcoded feature paths.
    g_game.enableFeature(GamePlayerFamiliars)
    -- ItemTierByte is negotiated by the server when optional tier display is enabled.
    g_game.enableFeature(GameProficiency)
    g_game.enableFeature(GameUnjustifiedPoints)
    g_game.enableFeature(GamePrey)
  elseif version == 1524 then
    -- Reserved for the future 15.24 profile.
  end

  modules.game_things.load()
end
