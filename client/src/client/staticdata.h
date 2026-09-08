/*
 * Copyright (c) 2010-2017 OTClient <https://github.com/edubart/otclient>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

#ifndef STATICDATA_H
#define STATICDATA_H

#include "global.h"

#include <string>
#include <vector>

struct GemData
{
    uint16_t gemID = 0;
    uint8_t locked = 0;
    uint8_t gemDomain = 0;
    uint8_t gemType = 0;
    uint8_t lesserBonus = 0;
    uint8_t regularBonus = 0;
    uint8_t supremeBonus = 0;
};

struct DailyRewardSelectableItem
{
    uint16_t item = 0;
    std::string name;
    uint32_t oz = 0;
};

struct DailyRewardEntry
{
    uint8_t type = 0;
    uint8_t amount = 0;
    std::vector<DailyRewardSelectableItem> items;
    uint8_t preyCount = 0;
    uint16_t xpboost = 0;
};

// Task Board Bounty
struct TaskBoardBountyHeaderData {
    uint8_t state{ 0 };
    uint8_t difficulty{ 0 };
    uint8_t rerollTokens{ 0 };
    uint8_t rerollMode{ 0 };
    uint32_t rerollTimestamp{ 0 };
    uint8_t upgrade{ 0 };
    uint8_t preferredSlots{ 0 };
};

struct TaskBoardBountyMonsterData {
    uint8_t taskIndex{ 0 };
    uint16_t raceId{ 0 };
    uint16_t currentKills{ 0 };
    uint16_t totalKills{ 0 };
    uint16_t rewardXp{ 0 };
    uint16_t rewardPoints{ 0 };
    uint8_t grade{ 0 };
    uint8_t claimState{ 0 };
    uint8_t isActive{ 0 };
    uint8_t isCompleted{ 0 };
};

struct TaskBoardTalismanData {
    uint8_t currentLevel{ 0 };
    uint8_t isActiveUpgrade{ 0 };
    uint16_t upgradeCost{ 0 };
    uint16_t currentValue{ 0 };
    uint16_t nextValue{ 0 };
};

struct TaskBoardPreferredSlotData {
    uint8_t slot{ 0 };
    uint8_t locked{ 1 };
    uint16_t preferred{ 0 };
    uint16_t unwanted{ 0 };
};

// Task Board Weekly
struct TaskBoardWeeklyHeaderData {
    uint8_t difficulty{ 0 };
    uint8_t remainingDays{ 7 };
    uint8_t totalTaskSlots{ 6 };
    uint32_t maxExperience{ 0 };
    uint32_t maxDeliveryExperience{ 0 };
    uint8_t completedKillTasks{ 0 };
    uint8_t completedDeliveryTasks{ 0 };
    uint8_t weeklyProgress{ 0 };
    uint32_t pointsEarned{ 0 };
    uint32_t soulsealsEarned{ 0 };
    uint32_t soulsealsBalance{ 0 };
    uint8_t extraSlot{ 0 };
};

struct TaskBoardWeeklyMonsterData {
    uint16_t raceId{ 0 };
    uint16_t current{ 0 };
    uint16_t total{ 0 };
    uint8_t state{ 0 };
    uint8_t grade{ 0 };
};

struct TaskBoardWeeklyItemData {
    uint8_t slotIndex{ 0 };
    uint16_t itemId{ 0 };
    uint8_t amount{ 0 };
    uint8_t required{ 0 };
    uint32_t available{ 0 };
    uint8_t grade{ 0 };
    uint8_t claimed{ 0 };
    uint8_t state{ 0 };
};

// Task Board Shop
struct TaskBoardShopItemData {
    uint8_t id{ 0 };
    uint8_t offerType{ 0 };
    std::string title;
    std::string description;
    uint16_t maxPurchases{ 0 };
    uint32_t price{ 0 };
    uint8_t purchased{ 0 };
    uint32_t clientId{ 0 };
    uint32_t extraClientId{ 0 };
    uint8_t addons{ 0 };
};

// Soul Seals
struct SoulSealEntryData {
    uint16_t raceId{ 0 };
    std::string name;
    uint8_t stars{ 0 };
    uint32_t cost{ 0 };
    uint8_t mastered{ 0 };
};

#endif
