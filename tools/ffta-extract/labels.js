'use strict';
/* Rotulos em linguagem natural para os campos enumerados da ROM de FFTA.
 * Fontes: Data Crystal (Items / Abilities / Jobs) + verificacao no jogo. */

const ITEM_TYPE = [
  'None', 'Sword', 'Blade', 'Saber', 'Knight Sword', 'Great Sword', 'Broadsword',
  'Knife', 'Rapier', 'Katana', 'Staff', 'Rod', 'Mace', 'Bow', 'Great Bow', 'Spear',
  'Instrument', 'Knuckles', 'Soul', 'Gun', 'Shield', 'Helmet', 'Ribbon', 'Hat',
  'Armor', 'Clothing', 'Robe', 'Shoes', 'Armlets', 'Accessory', 'Consumable',
];

const ELEMENT = ['None', 'Fire', 'Wind', 'Earth', 'Water', 'Ice', 'Lightning', 'Holy', 'Dark'];

const WORN = ['Not worn', 'One-handed', 'Two-handed', 'Head', 'Body', 'Feet', 'Arms', 'Accessory'];

// mesma ordem de bits usada tanto em item.Type quanto na mascara de equipamento do job
const EQUIP_SLOT_BITS = [
  'Sword', 'Blade', 'Saber', 'Knight Sword', 'Great Sword', 'Broadsword', 'Knife',
  'Rapier', 'Katana', 'Staff', 'Rod', 'Mace', 'Bow', 'Great Bow', 'Spear',
  'Instrument', 'Knuckles', 'Soul', 'Gun', 'Shield', 'Helmet', 'Ribbon', 'Hat',
  'Armor', 'Clothing', 'Robe', 'Shoes', 'Armlets', 'Accessory', '(unused 1D)',
  '(unused 1E)', '(unused 1F)',
];

const RACE = {
  0x01: 'Hume', 0x02: 'Bangaa', 0x03: 'Nu Mou', 0x04: 'Viera', 0x05: 'Moogle',
  0x06: 'Monster: Goblin', 0x07: 'Monster: Flan', 0x08: 'Monster: Bomb',
  0x09: 'Monster: Dragon', 0x0A: 'Monster: Lamia', 0x0B: 'Monster: Antlion/Spider',
  0x0C: 'Monster: Blade Biter', 0x0D: 'Monster: Tonberry', 0x0E: 'Monster: Panther',
  0x0F: 'Monster: Malboro', 0x10: 'Monster: Ahriman', 0x11: 'Monster: Undead',
  0x12: 'Monster: Fairy', 0x13: 'Special: Llednar', 0x14: 'Special: Playable',
  0x15: 'Special: Totema', 0x16: 'Special: Li-Grim', 0x17: 'Judge',
};

const ABILITY_TYPE = { 0x00: 'Break', 0x01: 'Action', 0x02: 'Reaction', 0x03: 'Support', 0x05: 'Combo' };

const WEAPON_REQ = ['Not required', 'Weapon required', 'Spear required (Jump)', 'Bow required (Doom Archer)'];

const TARGETING = [
  'No targeting', 'Cursor selection', 'Auto-select (no help text)', 'Auto-select (help text)',
  'Directional', 'Pierce', 'In front of caster', 'In front of and behind caster',
];

const ELEM_RESIST = ['Weak', 'Normal', 'Nullify', 'Absorb', 'Resist', 'Resist', 'Resist', 'Resist'];
// ordem dos 8 campos de 3 bits em job.Elements (do bit mais alto ao mais baixo)
const ELEM_RESIST_ORDER = ['Dark', 'Holy', 'Lightning', 'Ice', 'Water', 'Earth', 'Wind', 'Fire'];

const MOVE_STANCE = ['Errorous', 'Normal', 'Normal', 'Crawl', 'Float (walks on water)', 'Tonberry'];
const MOVE_TYPE = ['Errorous', 'Walk', 'Fly', 'Teleport'];

const AI_BEHAVIOR = ['Unknown', 'Prioritize low HP', 'Prioritize healthy', 'Last resort'];

// Nome legivel do bloco de 3 bits de resistencia
function resistName(v) {
  if (v === 0) return 'Weak';
  if (v === 1) return 'Normal';
  if (v === 2) return 'Nullify';
  if (v === 3) return 'Absorb';
  return 'Resist';
}

module.exports = {
  ITEM_TYPE, ELEMENT, WORN, EQUIP_SLOT_BITS, RACE, ABILITY_TYPE, WEAPON_REQ,
  TARGETING, ELEM_RESIST_ORDER, MOVE_STANCE, MOVE_TYPE, AI_BEHAVIOR, resistName,
};
