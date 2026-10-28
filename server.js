'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

/* ============================================================
   TUNABLE NUMBERS — change these after playtesting
   ============================================================ */
const C = {
  MIN_PLAYERS: 3,
  MAX_PLAYERS: 6,
  DEFAULT_ROUNDS: 5,
  MIN_ROUNDS: 3,
  MAX_ROUNDS: 8,

  START_HP: 100,
  START_GOLD: 40,
  START_POTIONS: 1,
  POTION_HEAL: 40,
  REST_HEAL: 10,

  // phase lengths in seconds at normal pace; the host picks a pace in the lobby
  TIME: { setup: 60, dm: 75, adv: 45, results: 35 },
  PACE: { relaxed: 1.5, normal: 1, fast: 0.7 },
  DEFAULT_PACE: 'normal',

  // per-round DM gold budget and mana income
  goldBudget: (doors, round) => doors * (10 + 10 * round),
  manaIncome: (doors, round) => doors * (3 + 2 * round),
  // the DM starts each dungeon with this much mana banked, so round 1 has real choices
  DM_START_MANA: 8,

  // scanning doors with the lantern
  SCAN_MS: 3000,                                   // how long a scan takes
  flasksPerRound: (doors) => Math.max(1, doors - 1),
  flaskCap: (doors) => doors,                      // the most oil you can carry
  MIN_DOOR_GOLD: 10,

  TRAPS: {
    minor: { name: 'Minor', cost: 8, dmg: 20 },
    major: { name: 'Major', cost: 14, dmg: 35 },
    deadly: { name: 'Deadly', cost: 20, dmg: 50 },
  },
  ILLUSION_COST: 6,

  APPROACH: {
    sprint: { name: 'Sprint', bags: 3, mult: 1.5 },
    walk: { name: 'Walk', bags: 2, mult: 1.0 },
    sneak: { name: 'Sneak', bags: 1, mult: 0.5 },
  },
  ROOM_BAGS: 3,
  LOCK_MULT: 2.5,
  SHOVE_MULT: 1.5,

  RESIST: 0.5,
  WEAK: 1.5,
  CHARM: 0.5,
  ARMOUR: 0.5,

  HAUNT_STEAL: 0.25,
  DEATH_DROP: 0.5,

  SHOP: {
    potion: { name: 'Potion', cost: 10, text: 'Heal 40 HP. Drink any time during your turn.' },
    oil: { name: 'Oil flask', cost: 6, text: 'Fuel for one more lantern scan. You can carry as many flasks as there are doors.' },
    armour: { name: 'Armour', cost: 12, text: 'Take half damage this round.' },
    charm: { name: 'Charm', cost: 6, text: 'Resist one element of your choice this round.' },
    lens: { name: 'Lens', cost: 10, text: 'Fit it to your lantern: your next scan shows the real trap and its strength, even through a fake clue.' },
    lock: { name: 'Lock', cost: 10, text: 'Enter alone and take all the gold. Others on that door are locked out. You take 2.5× damage.' },
    shove: { name: 'Shove', cost: 8, text: 'If your target picks your door, they spring the trap alone at 1.5×.' },
  },
};

const ELEMENTS = ['fire', 'water', 'earth', 'air'];
const WEAK_TO = { fire: 'water', air: 'fire', earth: 'air', water: 'earth' };
const ITEM_KEYS = ['armour', 'charm', 'lens', 'lock', 'shove'];

// what the client is allowed to know about the config
/* ============================================================
   Messages players can say, loaded from messages.txt
   ============================================================ */
const MSG_SECTIONS = ['adventurer', 'dm', 'ghost', 'merchant', 'huddle'];
const MSG_MAX_LEN = 60;
const MSG_MAX_COUNT = 24;
function loadMessages(file) {
  const out = Object.fromEntries(MSG_SECTIONS.map((k) => [k, []]));
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.warn('messages.txt not found; using a few built-in messages');
    text = '[adventurer]\nTrust me.\nLiar!\n[dm]\nMwahaha!\n[ghost]\nI see everything.\n[merchant]\nBuy something!\n[huddle]\nLet\'s both take Door {door}.';
  }
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const head = line.match(/^\[([a-z]+)\]$/i);
    if (head) {
      section = MSG_SECTIONS.includes(head[1].toLowerCase()) ? head[1].toLowerCase() : null;
      continue;
    }
    if (section && out[section].length < MSG_MAX_COUNT) out[section].push(line.slice(0, MSG_MAX_LEN));
  }
  return out;
}
const MESSAGES = loadMessages(path.join(__dirname, 'messages.txt'));

// the waiting room: positions are 0..1 across the hall floor, the same on every screen
const ROOM = {
  // the top-down room's floor, in the same units as public/room.js
  FLOOR_W: 332,
  FLOOR_H: 248,
  NEAR: 44, // how close two players must stand to whisper; the client offers it at 36, leaving room for lag
  EMOTE_COOLDOWN_MS: 2500,
  WHISPER_COOLDOWN_MS: 2000,
  MOVE_MIN_MS: 70,
};
const FACING = ['up', 'down', 'left', 'right'];
// everyone starts along the bottom of the room, clear of the shop counter and the barrels
function defaultSpot(k, m) {
  return { x: m <= 1 ? 0.6 : 0.3 + (0.56 * k) / (m - 1), y: 0.94, d: 'up' };
}
function nearEnough(a, b) {
  if (!a || !b) return false;
  const dx = (a.x - b.x) * ROOM.FLOOR_W;
  const dy = (a.y - b.y) * ROOM.FLOOR_H;
  return Math.hypot(dx, dy) <= ROOM.NEAR;
}

const PUBLIC_CONFIG = {
  MIN_PLAYERS: C.MIN_PLAYERS, MAX_PLAYERS: C.MAX_PLAYERS,
  MIN_ROUNDS: C.MIN_ROUNDS, MAX_ROUNDS: C.MAX_ROUNDS,
  START_HP: C.START_HP, START_GOLD: C.START_GOLD, START_POTIONS: C.START_POTIONS,
  POTION_HEAL: C.POTION_HEAL, REST_HEAL: C.REST_HEAL,
  MIN_DOOR_GOLD: C.MIN_DOOR_GOLD, TRAPS: C.TRAPS, ILLUSION_COST: C.ILLUSION_COST,
  APPROACH: C.APPROACH, ROOM_BAGS: C.ROOM_BAGS, LOCK_MULT: C.LOCK_MULT, SHOVE_MULT: C.SHOVE_MULT,
  RESIST: C.RESIST, WEAK: C.WEAK, CHARM: C.CHARM, ARMOUR: C.ARMOUR,
  HAUNT_STEAL: C.HAUNT_STEAL, DEATH_DROP: C.DEATH_DROP, SHOP: C.SHOP,
  TIME: C.TIME, PACE: C.PACE, DM_START_MANA: C.DM_START_MANA, SCAN_MS: C.SCAN_MS,
  MESSAGES, NEAR: ROOM.NEAR, FLOOR_W: ROOM.FLOOR_W, FLOOR_H: ROOM.FLOOR_H,
  ELEMENTS, WEAK_TO,
};

/* ============================================================
   Server setup
   ============================================================ */
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function nameOf(room, id) {
  const p = room.players.find((x) => x.id === id);
  return p ? p.name : '???';
}

function listNames(room, ids) {
  const n = ids.map((id) => nameOf(room, id));
  if (n.length <= 1) return n.join('');
  return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ============================================================
   Phase + timer handling
   ============================================================ */
const TIME_SCALE = Number(process.env.TIME_SCALE || 1); // dev only: speeds up timers
function phaseTime(room, key) {
  return Math.round(C.TIME[key] * (C.PACE[room.settings.pace] || 1));
}
function setPhase(room, phase, secs, onExpire) {
  if (secs) secs = secs * TIME_SCALE;
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  room.phase = phase;
  room.deadline = secs ? Date.now() + secs * 1000 : null;
  if (secs && onExpire) {
    room.timer = setTimeout(() => {
      room.timer = null;
      try {
        onExpire();
      } catch (e) {
        console.error('Phase expiry error', e);
      }
    }, secs * 1000);
  }
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', viewFor(room, p));
  }
}

/* ============================================================
   Match & dungeon flow
   ============================================================ */
function startMatch(room) {
  const order = room.players.map((p) => p.id);
  room.match = {
    dmOrder: order,
    dIndex: 0,
    totals: Object.fromEntries(order.map((id) => [id, 0])),
    history: [],
    dungeon: null,
    log: {
      game: 'Greed & Spite',
      started: new Date().toISOString(),
      players: order.map((id) => nameOf(room, id)),
      settings: { ...room.settings },
      config: {
        startHp: C.START_HP, startGold: C.START_GOLD, traps: C.TRAPS, illusionCost: C.ILLUSION_COST,
        shop: Object.fromEntries(Object.entries(C.SHOP).map(([k, v]) => [k, v.cost])),
      },
      dungeons: [],
      finalTotals: null,
    },
  };
  startDungeon(room);
}

function startDungeon(room) {
  const m = room.match;
  const dmId = m.dmOrder[m.dIndex];
  const advIds = m.dmOrder.filter((id) => id !== dmId && !room.players.find((p) => p.id === id && p.left));
  const doorsCount = Math.max(2, advIds.length - 1);
  const rounds = room.settings.rounds;
  let goldTotal = 0;
  for (let r = 1; r <= rounds; r++) goldTotal += C.goldBudget(doorsCount, r);
  const P = goldTotal + advIds.length * C.START_GOLD;

  const adv = {};
  for (const id of advIds) {
    adv[id] = {
      hp: C.START_HP,
      gold: C.START_GOLD,
      potions: C.START_POTIONS,
      inv: { armour: 0, charm: 0, lens: 0, lock: 0, shove: 0 },
      flasks: 0,
      affinity: null,
      alive: true,
      setupReady: false,
    };
  }
  m.dungeon = {
    dmId, advIds, doorsCount, rounds, round: 0, P, mana: C.DM_START_MANA, budget: 0, adv,
    doors: null, draft: null, actions: {}, haunts: {}, ghostDone: {}, lens: {},
    lastResult: null, scores: null, history: [], awards: null, pos: {}, known: {}, scans: {}, scanCount: {},
  };
  m.log.dungeons.push({
    dungeon: m.dIndex + 1,
    dm: nameOf(room, dmId),
    adventurers: advIds.map((id) => nameOf(room, id)),
    doorsPerRound: doorsCount,
    pot: P,
    affinities: {},
    shop: [],
    rounds: [],
    scores: null,
    awards: null,
  });
  resetSpots(m.dungeon);
  setPhase(room, 'setup', phaseTime(room, 'setup'), () => endSetup(room));
  broadcast(room);
}

function dlog(room) {
  const L = room.match.log.dungeons;
  return L[L.length - 1];
}
/* ---------- scanning doors with the lantern ---------- */
const scanMs = () => Math.round(C.SCAN_MS * TIME_SCALE);
// a door's position across the room floor, in the same 0..1 units as positions (see public/room.js)
const doorNx = (i, n) => ((384 * (i + 1)) / (n + 1) - 26) / 332;
function nearDoor(d, p, i) {
  return !!p && p.y <= 0.14 && Math.abs(p.x - doorNx(i, d.doorsCount)) <= 0.11;
}
function stopScan(room, pid, refund, reason) {
  const d = room.match && room.match.dungeon;
  const scan = d && d.scans && d.scans[pid];
  if (!scan) return;
  clearTimeout(scan.timer);
  delete d.scans[pid];
  if (refund && d.adv[pid]) {
    d.adv[pid].flasks += 1;
    if (scan.lens) d.adv[pid].inv.lens += 1;
  }
  io.to(room.code).emit('scan', { id: pid, door: scan.door, on: false });
  const p = room.players.find((x) => x.id === pid);
  if (p && p.socketId) io.to(p.socketId).emit('scanResult', { door: scan.door, cancelled: true, reason: reason || 'cancelled' });
}
function stopAllScans(d, refund) {
  if (!d || !d.scans) return;
  for (const [pid, scan] of Object.entries(d.scans)) {
    clearTimeout(scan.timer);
    if (refund && d.adv[pid]) {
      d.adv[pid].flasks += 1;
      if (scan.lens) d.adv[pid].inv.lens += 1;
    }
  }
  d.scans = {};
}
function finishScan(room, pid) {
  const d = room.match && room.match.dungeon;
  const scan = d && d.scans && d.scans[pid];
  if (!scan || room.phase !== 'adv') return;
  if (!nearDoor(d, d.pos[pid], scan.door)) return stopScan(room, pid, true, 'moved');
  delete d.scans[pid];
  const door = d.doors[scan.door];
  const mine = (d.known[pid] = d.known[pid] || {});
  const prev = mine[scan.door];
  mine[scan.door] = {
    clue: door.clue,
    lens: scan.lens ? { trap: door.trap, illusion: door.illusion !== null } : prev ? prev.lens : null,
  };
  d.scanCount[pid] = (d.scanCount[pid] || 0) + 1;
  shopLog(room, pid, {
    scanned: ROMAN[scan.door],
    saw: scan.lens ? `${trapText(door.trap) || 'no trap'}${door.illusion !== null ? ' (illusion broken)' : ''}` : `clue ${door.clue}`,
    lens: scan.lens,
  });
  io.to(room.code).emit('scan', { id: pid, door: scan.door, on: false });
  const p = room.players.find((x) => x.id === pid);
  if (p && p.socketId) io.to(p.socketId).emit('scanResult', { door: scan.door, ...mine[scan.door] });
  broadcast(room);
}

function shopLog(room, id, what) {
  const d = room.match.dungeon;
  dlog(room).shop.push({ round: d.round, phase: room.phase, player: nameOf(room, id), ...what });
}
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const trapText = (t) => (t ? `${C.TRAPS[t.tier].name} ${t.element}` : null);

function resetSpots(d) {
  d.pos = {};
  d.advIds.forEach((id, k) => (d.pos[id] = defaultSpot(k, d.advIds.length)));
}
const canRoam = (phase) => phase === 'setup' || phase === 'dm' || phase === 'adv';

function endSetup(room) {
  const d = room.match.dungeon;
  for (const id of d.advIds) if (!d.adv[id].affinity) d.adv[id].affinity = 'fire';
  for (const id of d.advIds) dlog(room).affinities[nameOf(room, id)] = d.adv[id].affinity;
  startRound(room);
}

function startRound(room) {
  const d = room.match.dungeon;
  d.round += 1;
  d.budget = C.goldBudget(d.doorsCount, d.round);
  d.mana += C.manaIncome(d.doorsCount, d.round);
  // fresh oil every round, up to what a lantern can carry
  for (const id of livingIds(d)) {
    const st = d.adv[id];
    st.flasks = Math.min(C.flaskCap(d.doorsCount), (st.flasks || 0) + C.flasksPerRound(d.doorsCount));
  }
  stopAllScans(d, false);
  d.known = {};
  d.scans = {};
  d.doors = null;
  d.draft = null;
  d.actions = {};
  d.drafts = {};
  d.haunts = {};
  d.ghostDone = {};

  d.lastResult = null;
  resetSpots(d);
  setPhase(room, 'dm', phaseTime(room, 'dm'), () => dmTimeout(room));
  broadcast(room);
}

function evenGold(d) {
  const base = Math.floor(d.budget / d.doorsCount);
  const arr = Array(d.doorsCount).fill(base);
  arr[0] += d.budget - base * d.doorsCount;
  return arr;
}

// returns {ok, error, doors, cost}
function validateDM(d, draft) {
  if (!draft || !Array.isArray(draft.doors) || draft.doors.length !== d.doorsCount) {
    return { ok: false, error: 'Set up every door.' };
  }
  let sum = 0;
  let cost = 0;
  const doors = [];
  for (const raw of draft.doors) {
    const gold = Number(raw && raw.gold);
    if (!Number.isInteger(gold) || gold < C.MIN_DOOR_GOLD) {
      return { ok: false, error: `Every door needs at least ${C.MIN_DOOR_GOLD} gold.` };
    }
    sum += gold;
    let trap = null;
    if (raw.trap) {
      if (!C.TRAPS[raw.trap.tier] || !ELEMENTS.includes(raw.trap.element)) {
        return { ok: false, error: 'Invalid trap.' };
      }
      trap = { tier: raw.trap.tier, element: raw.trap.element };
      cost += C.TRAPS[trap.tier].cost;
    }
    let illusion = null;
    if (raw.illusion !== null && raw.illusion !== undefined) {
      if (raw.illusion !== 'none' && !ELEMENTS.includes(raw.illusion)) {
        return { ok: false, error: 'Invalid illusion.' };
      }
      illusion = raw.illusion;
      cost += C.ILLUSION_COST;
    }
    doors.push({ gold, trap, illusion });
  }
  if (sum !== d.budget) {
    return { ok: false, error: `Place exactly ${d.budget} gold (you placed ${sum}).` };
  }
  if (cost > d.mana) {
    return { ok: false, error: `That costs ${cost} mana. You have ${d.mana}.` };
  }
  return { ok: true, doors, cost };
}

function commitDM(room, doors, cost, timedOut) {
  const d = room.match.dungeon;
  dlog(room).rounds.push({
    round: d.round,
    goldBudget: d.budget,
    manaAvailable: d.mana,
    manaSpent: cost,
    dmTimedOut: !!timedOut,
    doors: doors.map((x, i) => ({
      door: ROMAN[i], gold: x.gold, trap: trapText(x.trap),
      illusion: x.illusion, clueShown: x.illusion !== null ? x.illusion : x.trap ? x.trap.element : 'none',
    })),
  });
  d.mana -= cost;
  d.doors = doors.map((x) => ({
    ...x,
    clue: x.illusion !== null ? x.illusion : x.trap ? x.trap.element : 'none',
  }));
  d.dmTimedOut = !!timedOut;
  setPhase(room, 'adv', phaseTime(room, 'adv'), () => resolveRound(room));
  broadcast(room);
}

function dmTimeout(room) {
  const d = room.match.dungeon;
  let v = validateDM(d, d.draft);
  if (!v.ok && d.draft && Array.isArray(d.draft.doors) && d.draft.doors.length === d.doorsCount) {
    // keep the DM's traps, fix the gold
    const g = evenGold(d);
    v = validateDM(d, { doors: d.draft.doors.map((x, i) => ({ ...x, gold: g[i] })) });
  }
  if (!v.ok) {
    const g = evenGold(d);
    v = validateDM(d, { doors: g.map((gold) => ({ gold, trap: null, illusion: null })) });
  }
  commitDM(room, v.doors, v.cost, true);
}

function livingIds(d) {
  return d.advIds.filter((id) => d.adv[id].alive && !d.adv[id].left);
}
function ghostIds(d) {
  return d.advIds.filter((id) => !d.adv[id].alive && !d.adv[id].left);
}

function checkSetupDone(room) {
  const d = room.match.dungeon;
  const waiting = d.advIds.filter((id) => {
    const p = room.players.find((x) => x.id === id);
    return p && p.connected && !d.adv[id].setupReady;
  });
  const anyoneConnected = d.advIds.some((id) => { const p = room.players.find((x) => x.id === id); return p && p.connected; });
  if (anyoneConnected && waiting.length === 0) endSetup(room);
}

function checkAdvDone(room) {
  const d = room.match.dungeon;
  const connected = (id) => {
    const p = room.players.find((x) => x.id === id);
    return p && p.connected;
  };
  const waitingLiving = livingIds(d).filter((id) => connected(id) && !d.actions[id]);
  const waitingGhosts = ghostIds(d).filter((id) => connected(id) && !d.ghostDone[id]);
  const anyoneConnected = d.advIds.some(connected);
  if (anyoneConnected && waitingLiving.length === 0 && waitingGhosts.length === 0) resolveRound(room);
}

function cleanAction(d, st, pid, a) {
  if (!a || (a.type !== 'rest' && a.type !== 'door')) return { error: 'Pick a door or rest.' };
  if (a.type === 'rest') return { action: { type: 'rest' } };
  if (!Number.isInteger(a.door) || a.door < 0 || a.door >= d.doorsCount) return { error: 'Pick a door.' };
  if (!C.APPROACH[a.approach]) return { error: 'Pick Sprint, Walk or Sneak.' };
  const clean = { type: 'door', door: a.door, approach: a.approach, armour: false, charm: null, lock: false, shove: null };
  if (a.armour) { if (st.inv.armour < 1) return { error: 'You have no Armour.' }; clean.armour = true; }
  if (a.charm) {
    if (st.inv.charm < 1) return { error: 'You have no Charm.' };
    if (!ELEMENTS.includes(a.charm)) return { error: 'Pick an element for the Charm.' };
    clean.charm = a.charm;
  }
  if (a.lock) { if (st.inv.lock < 1) return { error: 'You have no Lock.' }; clean.lock = true; }
  if (a.shove) {
    if (st.inv.shove < 1) return { error: 'You have no Shove.' };
    if (a.shove === pid || !d.adv[a.shove] || !d.adv[a.shove].alive || d.adv[a.shove].left) return { error: 'Pick a living adventurer to shove.' };
    clean.shove = a.shove;
  }
  return { action: clean };
}

function damageFor(st, act, trap, mult) {
  let m = mult;
  if (trap.element === st.affinity) m *= C.RESIST;
  if (trap.element === WEAK_TO[st.affinity]) m *= C.WEAK;
  if (act.charm && act.charm === trap.element) m *= C.CHARM;
  if (act.armour) m *= C.ARMOUR;
  return Math.floor(C.TRAPS[trap.tier].dmg * m + 1e-9);
}

function trapLabel(trap) {
  return `${C.TRAPS[trap.tier].name} ${cap(trap.element)} trap`;
}

function resolveRound(room) {
  if (room.phase !== 'adv') return;
  const d = room.match.dungeon;
  for (const pid of Object.keys(d.scans || {})) stopScan(room, pid, true, 'time');
  const living = livingIds(d);
  const ghosts = ghostIds(d);
  const before = {};
  for (const id of d.advIds) before[id] = { hp: d.adv[id].hp, gold: d.adv[id].gold };

  // final actions, with item use verified and consumed
  const act = {};
  for (const id of living) {
    const st = d.adv[id];
    const a = d.actions[id] || (d.drafts && d.drafts[id]) || null;
    if (!a || a.type !== 'door') {
      act[id] = { type: 'rest', auto: !a };
      continue;
    }
    const f = { type: 'door', door: a.door, approach: a.approach, armour: false, charm: null, lock: false, shove: null };
    if (a.armour && st.inv.armour > 0) { st.inv.armour--; f.armour = true; }
    if (a.charm && st.inv.charm > 0) { st.inv.charm--; f.charm = a.charm; }
    if (a.lock && st.inv.lock > 0) { st.inv.lock--; f.lock = true; }
    if (a.shove && st.inv.shove > 0) { st.inv.shove--; f.shove = a.shove; }
    act[id] = f;
  }

  const dmg = {};
  const share = {};
  const result = { round: d.round, doors: [], rests: [], haunts: [], deaths: [], dmTimedOut: d.dmTimedOut, act, before, after: null };

  d.doors.forEach((door, i) => {
    const entrants = living.filter((id) => act[id].type === 'door' && act[id].door === i);
    const info = {
      index: i, gold: door.gold, trap: door.trap, illusion: door.illusion, clue: door.clue,
      entrants, triggered: [], lockedOut: [], shoved: [], lines: [], left: door.gold,
    };
    const lines = info.lines;

    if (entrants.length === 0) {
      lines.push(`Nobody entered. ${door.gold} gold stays with the dungeon.`);
      if (door.trap) lines.push(`It held a ${trapLabel(door.trap)}.`);
      else lines.push('It held no trap.');
      if (door.illusion !== null) lines.push('The clue was an illusion.');
      result.doors.push(info);
      return;
    }

    const movers = entrants.map((id) => `${nameOf(room, id)} ${{ sprint: 'sprinted', walk: 'walked', sneak: 'sneaked' }[act[id].approach]}`);
    lines.push(movers.join(', ') + '.');

    const lockers = entrants.filter((id) => act[id].lock);
    let triggers = [];
    let mult = 1;
    const myShare = {};

    if (lockers.length) {
      info.lockedOut = entrants.filter((id) => !act[id].lock);
      triggers = lockers;
      mult = C.LOCK_MULT;
      const each = Math.floor(door.gold / lockers.length);
      for (const id of lockers) myShare[id] = each;
      lines.push(`${listNames(room, lockers)} used a Lock and slammed the door.` +
        (info.lockedOut.length ? ` ${listNames(room, info.lockedOut)} ${info.lockedOut.length > 1 ? 'were' : 'was'} locked out.` : ''));
      const wasted = entrants.filter((id) => act[id].shove);
      if (wasted.length) lines.push(`The Lock beat ${listNames(room, wasted)}'s Shove.`);
    } else {
      const shoved = [];
      for (const id of entrants) {
        const t = act[id].shove;
        if (t && t !== id && entrants.includes(t) && !shoved.includes(t)) shoved.push(t);
      }
      const told = new Set();
      for (const id of entrants) {
        const t = act[id].shove;
        if (!t || !entrants.includes(t) || told.has(id)) continue;
        if (act[t].shove === id) {
          lines.push(`${nameOf(room, id)} and ${nameOf(room, t)} shoved each other in.`);
          told.add(t);
        } else {
          lines.push(`${nameOf(room, id)} shoved ${nameOf(room, t)} in first.`);
        }
        told.add(id);
      }
      if (shoved.length) {
        triggers = shoved;
        mult = C.SHOVE_MULT;
        info.shoved = shoved;
      } else {
        const fastest = ['sprint', 'walk', 'sneak'].find((a) => entrants.some((id) => act[id].approach === a));
        triggers = entrants.filter((id) => act[id].approach === fastest);
        mult = C.APPROACH[fastest].mult;
      }
      const bags = entrants.reduce((s, id) => s + C.APPROACH[act[id].approach].bags, 0);
      const denom = Math.max(C.ROOM_BAGS, bags);
      for (const id of entrants) myShare[id] = Math.floor((door.gold * C.APPROACH[act[id].approach].bags) / denom);
    }
    for (const id of entrants) {
      if (act[id].shove && !entrants.includes(act[id].shove)) {
        lines.push(`${nameOf(room, id)}'s Shove missed: ${nameOf(room, act[id].shove)} went elsewhere.`);
      }
    }

    info.triggered = triggers;
    info.damage = {};
    if (door.trap) {
      const hits = triggers.map((id) => {
        dmg[id] = damageFor(d.adv[id], act[id], door.trap, mult);
        info.damage[id] = dmg[id];
        return `${nameOf(room, id)} took ${dmg[id]}`;
      });
      lines.push(`${listNames(room, triggers)} sprang a ${trapLabel(door.trap)}: ${hits.join(', ')}.`);
    } else {
      lines.push('No trap.');
    }
    if (door.illusion !== null) lines.push('The clue was an illusion.');
    for (const [id, s] of Object.entries(myShare)) share[id] = s;
    info.share = myShare;
    result.doors.push(info);
  });

  // apply damage, then gold to survivors
  const died = [];
  for (const id of living) {
    const st = d.adv[id];
    if (dmg[id]) st.hp -= dmg[id];
    if (st.hp <= 0) died.push(id);
  }
  for (const info of result.doors) {
    let paid = 0;
    const parts = [];
    for (const [id, s] of Object.entries(info.share || {})) {
      if (died.includes(id)) {
        parts.push(`${nameOf(room, id)} died before grabbing anything`);
        continue;
      }
      d.adv[id].gold += s;
      paid += s;
      parts.push(`${nameOf(room, id)} +${s}`);
    }
    if (info.entrants.length) {
      info.left = info.gold - paid;
      info.lines.push(`Gold: ${parts.join(', ')}.` + (info.left > 0 ? ` ${info.left} left behind.` : ''));
    }
  }

  // rest
  for (const id of living) {
    if (act[id].type === 'rest') {
      const st = d.adv[id];
      const healed = Math.min(C.REST_HEAL, C.START_HP - st.hp);
      st.hp += healed;
      result.rests.push({ id, healed, auto: act[id].auto });
    }
  }

  // haunts (ghosts from before this round)
  const byTarget = {};
  for (const g of ghosts) {
    const t = d.haunts[g];
    if (t && dmg[t] > 0) (byTarget[t] = byTarget[t] || []).push(g);
  }
  for (const [t, gs] of Object.entries(byTarget)) {
    const pot = Math.floor(d.adv[t].gold * C.HAUNT_STEAL);
    const each = Math.floor(pot / gs.length);
    for (const g of gs) {
      d.adv[t].gold -= each;
      d.adv[g].gold += each;
      result.haunts.push({ ghost: g, target: t, stolen: each });
    }
  }
  for (const g of ghosts) {
    const t = d.haunts[g];
    if (t && !(dmg[t] > 0)) result.haunts.push({ ghost: g, target: t, stolen: 0 });
  }

  // deaths
  for (const id of died) {
    const st = d.adv[id];
    const drop = Math.floor(st.gold * C.DEATH_DROP);
    st.gold -= drop;
    st.hp = 0;
    st.alive = false;
    result.deaths.push({ id, dropped: drop });
  }

  result.after = {};
  for (const id of d.advIds) result.after[id] = { hp: d.adv[id].hp, gold: d.adv[id].gold };
  d.lastResult = result;
  d.history.push(result);
  logRound(room, d, result);

  setPhase(room, 'results', phaseTime(room, 'results'), () => afterResults(room));
  broadcast(room);
}

function logRound(room, d, r) {
  const n = (id) => nameOf(room, id);
  const entry = dlog(room).rounds[dlog(room).rounds.length - 1];
  entry.choices = d.advIds.filter((id) => r.before[id].hp > 0 && r.act[id]).map((id) => {
    const a = r.act[id];
    if (a.type === 'rest') return { player: n(id), choice: a.auto ? 'rest (timed out)' : 'rest' };
    return {
      player: n(id), choice: a.approach, door: ROMAN[a.door],
      items: [a.lock && 'lock', a.armour && 'armour', a.charm && `charm:${a.charm}`, a.shove && `shove:${n(a.shove)}`].filter(Boolean),
    };
  });
  entry.outcome = r.doors.map((x) => ({
    door: ROMAN[x.index],
    entered: x.entrants.map(n),
    sprangTrap: x.trap ? x.triggered.map(n) : [],
    lockedOut: x.lockedOut.map(n),
    damage: Object.fromEntries(Object.entries(x.damage || {}).map(([id, v]) => [n(id), v])),
    gold: Object.fromEntries(Object.entries(x.share || {}).filter(([id]) => !r.deaths.some((q) => q.id === id)).map(([id, v]) => [n(id), v])),
    leftBehind: x.left,
    story: x.lines.join(' '),
  }));
  entry.haunts = r.haunts.map((h) => ({ ghost: n(h.ghost), target: n(h.target), stolen: h.stolen }));
  entry.deaths = r.deaths.map((x) => ({ player: n(x.id), dropped: x.dropped }));
  entry.after = Object.fromEntries(d.advIds.map((id) => [n(id), { hp: r.after[id].hp, gold: r.after[id].gold, alive: d.adv[id].alive }]));
}

/* ---------- end-of-dungeon awards ---------- */
function computeAwards(room, d) {
  const st = {};
  for (const id of d.advIds) st[id] = { grabbed: 0, canary: 0, spite: 0, stolen: 0, sprints: 0, rests: 0, entered: 0, damage: 0, scans: (d.scanCount || {})[id] || 0 };
  let dmDamage = 0;
  let kills = 0;
  for (const r of d.history) {
    const died = (id) => r.deaths.some((x) => x.id === id);
    for (const x of r.doors) {
      const lockers = x.entrants.filter((id) => r.act[id].lock);
      for (const id of x.entrants) {
        st[id].entered++;
        if (r.act[id].approach === 'sprint' && !r.act[id].lock) st[id].sprints++;
        const t = r.act[id].shove;
        if (!lockers.length && t && x.entrants.includes(t)) st[id].spite++;
      }
      for (const id of lockers) st[id].spite += x.lockedOut.length;
      for (const [id, s] of Object.entries(x.share || {})) if (!died(id)) st[id].grabbed += s;
      for (const [id, v] of Object.entries(x.damage || {})) { st[id].damage += v; dmDamage += v; }
      if (x.trap) {
        const safeGain = x.entrants.some((id) => !x.triggered.includes(id) && !x.lockedOut.includes(id) && (x.share[id] || 0) > 0 && !died(id));
        if (safeGain) for (const [id, v] of Object.entries(x.damage || {})) st[id].canary += v;
      }
    }
    for (const x of r.rests) st[x.id].rests++;
    for (const h of r.haunts) if (h.stolen > 0) { st[h.ghost].stolen += h.stolen; st[h.ghost].spite++; }
    kills += r.deaths.length;
  }
  const defs = [
    { key: 'greediest', title: 'Greediest', stat: 'grabbed', text: (v) => `grabbed ${v} gold from the rooms` },
    { key: 'canary', title: 'The Canary', stat: 'canary', text: (v) => `took ${v} damage so others behind them could loot safely` },
    { key: 'spiteful', title: 'Most Spiteful', stat: 'spite', text: (v) => `landed ${v} spiteful move${v === 1 ? '' : 's'} (shoves, lockouts, hauntings)` },
    { key: 'robber', title: 'Grave Robber', stat: 'stolen', text: (v) => `stole ${v} gold as a ghost` },
    { key: 'daredevil', title: 'Daredevil', stat: 'sprints', text: (v) => `sprinted in ${v} time${v === 1 ? '' : 's'}` },
    { key: 'coward', title: 'Campfire Coward', stat: 'rests', text: (v) => `rested by the fire ${v} time${v === 1 ? '' : 's'}` },
    { key: 'scout', title: 'The Scout', stat: 'scans', text: (v) => `scanned ${v} door${v === 1 ? '' : 's'} with the lantern` },
  ];
  const awards = [];
  for (const def of defs) {
    const best = Math.max(...d.advIds.map((id) => st[id][def.stat]));
    if (best <= 0) continue;
    const who = d.advIds.filter((id) => st[id][def.stat] === best);
    awards.push({ key: def.key, title: def.title, players: who, text: def.text(best) });
  }
  const untouched = d.advIds.filter((id) => st[id].entered >= 2 && st[id].damage === 0);
  if (untouched.length) {
    const most = Math.max(...untouched.map((id) => st[id].entered));
    awards.push({ key: 'untouchable', title: 'Untouchable', players: untouched.filter((id) => st[id].entered === most), text: `walked into ${most} rooms without a scratch` });
  }
  if (dmDamage > 0) {
    awards.push({ key: 'trapmaster', title: 'Trapmaster', players: [d.dmId], text: `dealt ${dmDamage} damage` + (kills ? ` and claimed ${kills} li${kills === 1 ? 'fe' : 'ves'}` : '') });
  }
  return awards;
}

function afterResults(room) {
  const d = room.match.dungeon;
  if (d.round >= d.rounds || livingIds(d).length === 0) endDungeon(room);
  else startRound(room);
}

// early: the DM left, or too few players remain. Only gold that was actually put in play counts.
function endDungeon(room, early) {
  const m = room.match;
  const d = m.dungeon;
  const N = d.advIds.length;
  let P = d.P;
  if (early) {
    const placed = room.phase === 'dm' || room.phase === 'setup' ? d.round - 1 : d.round;
    P = d.advIds.length * C.START_GOLD;
    for (let r = 1; r <= placed; r++) P += C.goldBudget(d.doorsCount, r);
    d.endedEarly = early;
  }
  let sumHeld = 0;
  const scores = {};
  for (const id of d.advIds) {
    const held = d.adv[id].gold;
    sumHeld += held;
    scores[id] = { role: 'adv', held, alive: d.adv[id].alive, left: !!d.adv[id].left, score: Math.round(((held * N) / P) * 1000) / 10 };
  }
  const dmLeft = early === 'dmLeft';
  scores[d.dmId] = { role: 'dm', held: P - sumHeld, left: dmLeft, score: dmLeft ? 0 : Math.round(((P - sumHeld) / P) * 1000) / 10 };
  d.P = P;
  for (const [id, s] of Object.entries(scores)) m.totals[id] = Math.round((m.totals[id] + s.score) * 10) / 10;
  d.scores = scores;
  d.awards = computeAwards(room, d);
  stopAllScans(d, false);
  m.history.push({ dmId: d.dmId, P: d.P, scores });
  const L = dlog(room);
  L.scores = Object.fromEntries(Object.entries(scores).map(([id, sc]) => [nameOf(room, id), { role: sc.role, goldHeld: sc.held, score: sc.score }]));
  L.awards = d.awards.map((a) => ({ title: a.title, players: a.players.map((id) => nameOf(room, id)), text: a.text }));
  m.log.totals = Object.fromEntries(Object.entries(m.totals).map(([id, v]) => [nameOf(room, id), v]));
  if (early) L.endedEarly = early === 'dmLeft' ? 'The DM left' : 'Too few players';
  if (activePlayers(room).length < C.MIN_PLAYERS) return endMatch(room);
  setPhase(room, 'dungeonEnd', null);
  broadcast(room);
}

/* ---------- leaving a match ---------- */
const activePlayers = (room) => room.players.filter((p) => !p.left);
function endMatch(room) {
  room.match.log.finished = new Date().toISOString();
  setPhase(room, 'matchEnd', null);
  broadcast(room);
}
// move on to the next dungeon whose DM is still here
function nextDungeon(room) {
  const m = room.match;
  do { m.dIndex++; } while (m.dIndex < m.dmOrder.length && room.players.find((p) => p.id === m.dmOrder[m.dIndex] && p.left));
  if (m.dIndex < m.dmOrder.length && activePlayers(room).length >= C.MIN_PLAYERS) startDungeon(room);
  else endMatch(room);
}
function playerLeft(room, player) {
  player.left = true;
  player.connected = false;
  player.socketId = null;
  if (room.hostId === player.id) {
    const next = room.players.find((p) => p.connected && !p.left);
    if (next) room.hostId = next.id;
  }
  const m = room.match;
  const d = m && m.dungeon;
  if (m && m.log) (m.log.left = m.log.left || []).push({ player: player.name, at: room.phase, dungeon: m.dIndex + 1, round: d ? d.round : 0 });
  if (!d || ['dungeonEnd', 'matchEnd'].includes(room.phase)) {
    if (room.phase === 'dungeonEnd' && activePlayers(room).length < C.MIN_PLAYERS) return endMatch(room);
    return broadcast(room);
  }
  stopScan(room, player.id, false);
  if (player.id === d.dmId) { stopAllScans(d, false); return endDungeon(room, 'dmLeft'); }
  if (d.adv[player.id]) {
    // they walk out with their gold; it still counts for their score
    d.adv[player.id].left = true;
    delete d.actions[player.id];
    if (d.drafts) delete d.drafts[player.id];
    delete d.pos[player.id];
  }
  if (activePlayers(room).length < C.MIN_PLAYERS) return endDungeon(room, 'fewPlayers');
  if (livingIds(d).length === 0 && room.phase !== 'results') return endDungeon(room, 'fewPlayers');
  broadcast(room);
  if (room.phase === 'setup') checkSetupDone(room);
  if (room.phase === 'adv') checkAdvDone(room);
}

/* ============================================================
   Per-player view (hidden information lives here)
   ============================================================ */
function viewFor(room, p) {
  const v = {
    code: room.code,
    me: p.id,
    hostId: room.hostId,
    phase: room.phase,
    deadline: room.deadline,
    now: Date.now(),
    settings: room.settings,
    config: PUBLIC_CONFIG,
    players: room.players.map((x) => ({ id: x.id, name: x.name, connected: x.connected, guide: !!x.guide, left: !!x.left })),
    match: null,
    hasLastLog: !!room.lastLog,
  };
  const m = room.match;
  if (!m) return v;
  v.match = { dIndex: m.dIndex, total: m.dmOrder.length, dmOrder: m.dmOrder, totals: m.totals, history: m.history, dungeon: null };
  const d = m.dungeon;
  if (!d) return v;

  const role = p.id === d.dmId ? 'dm' : d.adv[p.id] ? (d.adv[p.id].alive ? 'adv' : 'ghost') : 'spectator';
  const showResult = ['results', 'dungeonEnd'].includes(room.phase);
  const dv = {
    dmId: d.dmId, advIds: d.advIds, doorsCount: d.doorsCount, rounds: d.rounds, round: d.round,
    P: d.P, budget: d.budget, role,
    advs: d.advIds.map((id) => {
      const s = d.adv[id];
      let ready = false;
      if (room.phase === 'setup') ready = s.setupReady;
      if (room.phase === 'adv') ready = s.alive ? !!d.actions[id] : !!d.ghostDone[id];
      return { id, hp: s.hp, gold: s.gold, affinity: s.affinity, alive: s.alive, left: !!s.left, ready };
    }),
    doors: d.doors ? d.doors.map((x, i) => {
      if (role !== 'adv') return { gold: x.gold, clue: x.clue };
      const k = (d.known[p.id] || {})[i];
      return { gold: x.gold, clue: k ? k.clue : null };
    }) : null,
    scans: Object.fromEntries(Object.entries(d.scans || {}).map(([id, sc]) => [id, sc.door])),
    lastResult: showResult ? d.lastResult : null,
    scores: d.scores,
    awards: d.awards,
    endedEarly: d.endedEarly || null,
  };
  if (role === 'dm') {
    dv.dm = {
      mana: d.mana, draft: d.draft, doors: d.doors, timedOut: d.dmTimedOut,
      nextIncome: d.round < d.rounds ? C.manaIncome(d.doorsCount, d.round + 1) : 0,
    };
  }
  if (role === 'ghost' && room.phase === 'adv' && d.doors) {
    dv.sight = d.doors.map((x) => ({ trap: x.trap, illusion: x.illusion }));
  }
  if (role === 'ghost') {
    dv.myHaunt = d.haunts[p.id] || null;
    dv.ghostDone = !!d.ghostDone[p.id];
  }
  if (role === 'adv' || role === 'ghost') {
    const s = d.adv[p.id];
    const scan = d.scans && d.scans[p.id];
    dv.mine = {
      inv: s.inv, potions: s.potions, affinity: s.affinity, setupReady: s.setupReady, action: d.actions[p.id] || null,
      flasks: s.flasks, flaskCap: C.flaskCap(d.doorsCount), flasksPerRound: C.flasksPerRound(d.doorsCount),
      known: d.known[p.id] || {}, scanning: scan ? { door: scan.door, lens: scan.lens, left: Math.max(0, scan.endsAt - Date.now()) } : null,
    };
  }
  dv.pos = d.pos;
  v.match.dungeon = dv;
  return v;
}

/* ============================================================
   Socket handlers
   ============================================================ */
function ctx(socket) {
  const code = socket.data.code;
  const room = code && rooms.get(code);
  if (!room) return {};
  const player = room.players.find((p) => p.id === socket.data.pid);
  const d = room.match && room.match.dungeon;
  return { room, player, d };
}

function attach(socket, room, player) {
  player.socketId = socket.id;
  player.connected = true;
  player.lastSeen = Date.now();
  socket.data.code = room.code;
  socket.data.pid = player.id;
  socket.join(room.code);
  if (!room.players.some((p) => p.id === room.hostId && p.connected)) room.hostId = player.id;
}

io.on('connection', (socket) => {
  const reply = (cb, payload) => { if (typeof cb === 'function') cb(payload); };

  socket.on('create', ({ name, token, guide } = {}, cb) => {
    name = cleanName(name);
    if (!name) return reply(cb, { error: 'Enter a name.' });
    const code = newCode();
    const player = { id: crypto.randomUUID(), name, token: String(token || ''), connected: true, guide: !!guide };
    const room = { code, players: [player], hostId: player.id, phase: 'lobby', settings: { rounds: C.DEFAULT_ROUNDS, pace: C.DEFAULT_PACE }, match: null, timer: null, deadline: null, emptySince: null };
    rooms.set(code, room);
    attach(socket, room, player);
    reply(cb, { ok: true, code });
    broadcast(room);
  });

  socket.on('join', ({ code, name, token, guide } = {}, cb) => {
    code = String(code || '').trim().toUpperCase();
    name = cleanName(name);
    const room = rooms.get(code);
    if (!room) return reply(cb, { error: `No game with code ${code || '(blank)'}.` });
    if (!name) return reply(cb, { error: 'Enter a name.' });
    let player = room.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (player && player.left && room.phase !== 'lobby') return reply(cb, { error: 'You left this match. You can join the next one from the lobby.' });
    if (player) {
      const sameToken = token && player.token === String(token);
      if (player.connected && !sameToken) return reply(cb, { error: `${player.name} is already in this game. Pick another name.` });
      if (player.socketId && player.socketId !== socket.id) {
        const old = io.sockets.sockets.get(player.socketId);
        if (old) old.disconnect(true);
      }
      player.token = String(token || player.token);
    } else {
      if (room.phase !== 'lobby') return reply(cb, { error: 'That game has already started. Only players already in it can rejoin.' });
      if (room.players.length >= C.MAX_PLAYERS) return reply(cb, { error: `That game is full (${C.MAX_PLAYERS} players).` });
      player = { id: crypto.randomUUID(), name, token: String(token || ''), connected: true };
      room.players.push(player);
    }
    if (guide) player.guide = true;
    attach(socket, room, player);
    room.emptySince = null;
    reply(cb, { ok: true, code });
    broadcast(room);
  });

  socket.on('leave', () => {
    const { room, player } = ctx(socket);
    if (!room || !player) return;
    socket.leave(room.code);
    socket.data.code = null;
    if (room.phase === 'lobby') {
      room.players = room.players.filter((p) => p.id !== player.id);
      if (room.hostId === player.id && room.players[0]) room.hostId = room.players[0].id;
      if (room.players.length === 0) rooms.delete(room.code);
      else broadcast(room);
      return;
    }
    playerLeft(room, player);
    if (room.players.every((p) => !p.connected)) room.emptySince = Date.now();
  });

  socket.on('kick', ({ pid } = {}) => {
    const { room, player } = ctx(socket);
    if (!room || room.hostId !== player.id || room.phase !== 'lobby' || pid === player.id) return;
    const target = room.players.find((p) => p.id === pid);
    if (!target) return;
    if (target.socketId) io.to(target.socketId).emit('kicked');
    room.players = room.players.filter((p) => p.id !== pid);
    broadcast(room);
  });

  socket.on('settings', ({ rounds, pace } = {}) => {
    const { room, player } = ctx(socket);
    if (!room || room.hostId !== player.id || room.phase !== 'lobby') return;
    const r = Number(rounds);
    if (Number.isInteger(r) && r >= C.MIN_ROUNDS && r <= C.MAX_ROUNDS) room.settings.rounds = r;
    if (C.PACE[pace]) room.settings.pace = pace;
    broadcast(room);
  });

  socket.on('start', (_, cb) => {
    const { room, player } = ctx(socket);
    if (!room || room.hostId !== player.id || room.phase !== 'lobby') return;
    if (room.players.length < C.MIN_PLAYERS) return reply(cb, { error: `You need at least ${C.MIN_PLAYERS} players.` });
    reply(cb, { ok: true });
    startMatch(room);
  });

  socket.on('affinity', ({ element } = {}) => {
    const { room, player, d } = ctx(socket);
    if (!d || room.phase !== 'setup' || !d.adv[player.id] || !ELEMENTS.includes(element)) return;
    d.adv[player.id].affinity = element;
    broadcast(room);
  });

  socket.on('setupReady', () => {
    const { room, player, d } = ctx(socket);
    if (!d || room.phase !== 'setup' || !d.adv[player.id]) return;
    if (!d.adv[player.id].affinity) return;
    d.adv[player.id].setupReady = true;
    broadcast(room);
    checkSetupDone(room);
  });

  socket.on('buy', ({ item } = {}, cb) => {
    const { room, player, d } = ctx(socket);
    if (!d || !['setup', 'dm', 'adv'].includes(room.phase)) return;
    const st = d.adv[player.id];
    const it = C.SHOP[item];
    if (!st || !st.alive || !it) return;
    if (st.gold < it.cost) return reply(cb, { error: `You need ${it.cost} gold.` });
    if (item === 'oil' && st.flasks >= C.flaskCap(d.doorsCount)) return reply(cb, { error: `Your lantern holds ${C.flaskCap(d.doorsCount)} flasks at most.` });
    st.gold -= it.cost;
    if (item === 'potion') st.potions++;
    else if (item === 'oil') st.flasks++;
    else st.inv[item]++;
    shopLog(room, player.id, { bought: item, cost: it.cost });
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('drink', (_, cb) => {
    const { room, player, d } = ctx(socket);
    if (!d || !['setup', 'dm', 'adv'].includes(room.phase)) return;
    const st = d.adv[player.id];
    if (!st || !st.alive || st.potions < 1) return;
    if (st.hp >= C.START_HP) return reply(cb, { error: 'You are already at full HP.' });
    st.potions--;
    const hpBefore = st.hp;
    st.hp = Math.min(C.START_HP, st.hp + C.POTION_HEAL);
    shopLog(room, player.id, { drank: 'potion', hpBefore, hpAfter: st.hp });
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('scanStart', ({ door, lens } = {}, cb) => {
    const { room, player, d } = ctx(socket);
    if (!d || room.phase !== 'adv') return reply(cb, { error: 'You can only scan while choosing a door.' });
    const st = d.adv[player.id];
    if (!st || !st.alive || st.left) return reply(cb, { error: 'Only living adventurers can scan.' });
    if (!Number.isInteger(door) || door < 0 || door >= d.doorsCount) return reply(cb, { error: 'Pick a door.' });
    if (d.scans[player.id]) return reply(cb, { error: 'You are already scanning.' });
    if (!nearDoor(d, d.pos[player.id], door)) return reply(cb, { error: 'Walk right up to the door first.' });
    const known = (d.known[player.id] || {})[door];
    if (known && (!lens || known.lens)) return reply(cb, { error: 'You already scanned this door.' });
    if (st.flasks < 1) return reply(cb, { error: 'Your lantern is out of oil. The shopkeeper sells more.' });
    if (lens && st.inv.lens < 1) return reply(cb, { error: 'You have no Lens.' });
    const ms = scanMs();
    if (room.deadline && room.deadline - Date.now() < ms + Math.round(250 * TIME_SCALE)) return reply(cb, { error: 'Not enough time left to scan.' });
    st.flasks -= 1;
    if (lens) st.inv.lens -= 1;
    const scan = { door, lens: !!lens, endsAt: Date.now() + ms };
    scan.timer = setTimeout(() => finishScan(room, player.id), ms);
    d.scans[player.id] = scan;
    io.to(room.code).emit('scan', { id: player.id, door, on: true });
    reply(cb, { ok: true, ms });
    broadcast(room);
  });

  socket.on('scanCancel', ({ reason } = {}) => {
    const { room, player, d } = ctx(socket);
    if (!d || !d.scans || !d.scans[player.id]) return;
    stopScan(room, player.id, true, reason === 'moved' ? 'moved' : 'cancelled');
    broadcast(room);
  });

  socket.on('dmDraft', (draft) => {
    const { room, player, d } = ctx(socket);
    if (!d || room.phase !== 'dm' || player.id !== d.dmId) return;
    d.draft = draft;
  });

  socket.on('dmSubmit', (draft, cb) => {
    const { room, player, d } = ctx(socket);
    if (!d || room.phase !== 'dm' || player.id !== d.dmId) return;
    const v = validateDM(d, draft);
    if (!v.ok) return reply(cb, { error: v.error });
    reply(cb, { ok: true });
    commitDM(room, v.doors, v.cost, false);
  });

  socket.on('action', (a, cb) => {
    const { room, player, d } = ctx(socket);
    if (!d || room.phase !== 'adv') return;
    const st = d.adv[player.id];
    if (!st || !st.alive || st.left) return;
    const v = cleanAction(d, st, player.id, a);
    if (v.error) return reply(cb, { error: v.error });
    d.actions[player.id] = v.action;
    reply(cb, { ok: true });
    broadcast(room);
    checkAdvDone(room);
  });

  // the plan as it stands, used if time runs out before locking in
  socket.on('actionDraft', (a) => {
    const { room, player, d } = ctx(socket);
    if (!d || room.phase !== 'adv') return;
    const st = d.adv[player.id];
    if (!st || !st.alive || st.left) return;
    const v = cleanAction(d, st, player.id, a);
    d.drafts = d.drafts || {};
    if (v.action) d.drafts[player.id] = v.action;
    else delete d.drafts[player.id];
  });

  socket.on('haunt', ({ target } = {}) => {
    const { room, player, d } = ctx(socket);
    if (!d || room.phase !== 'adv') return;
    const st = d.adv[player.id];
    if (!st || st.alive) return;
    if (target && (!d.adv[target] || !d.adv[target].alive)) return;
    d.haunts[player.id] = target || null;
    d.ghostDone[player.id] = true;
    broadcast(room);
    checkAdvDone(room);
  });

  socket.on('continue', () => {
    const { room, player } = ctx(socket);
    if (!room || room.hostId !== player.id) return;
    if (room.phase === 'results') afterResults(room);
    else if (room.phase === 'dungeonEnd') nextDungeon(room);
  });

  /* ---------- waiting room ---------- */
  socket.on('move', ({ x, y, d: dir } = {}) => {
    const { room, player, d } = ctx(socket);
    if (!d || !canRoam(room.phase) || !d.adv[player.id]) return;
    x = Number(x); y = Number(y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (d.adv[player.id].left) return;
    const spot = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), d: FACING.includes(dir) ? dir : 'down' };
    // always keep the newest position; if updates come too fast, send the latest one a moment later
    d.pos[player.id] = spot;
    const now = Date.now();
    const wait = player.lastMove ? ROOM.MOVE_MIN_MS - (now - player.lastMove) : 0;
    if (wait <= 0) {
      player.lastMove = now;
      io.to(room.code).emit('pos', { id: player.id, ...spot });
    } else if (!player.movePending) {
      player.movePending = setTimeout(() => {
        player.movePending = null;
        player.lastMove = Date.now();
        const latest = room.match && room.match.dungeon && room.match.dungeon.pos[player.id];
        if (latest) io.to(room.code).emit('pos', { id: player.id, ...latest });
      }, wait);
    }
    const scan = d.scans && d.scans[player.id];
    if (scan && !nearDoor(d, spot, scan.door)) { stopScan(room, player.id, true, 'moved'); broadcast(room); }
  });

  socket.on('emote', ({ i } = {}) => {
    const { room, player, d } = ctx(socket);
    if (!d || !['setup', 'dm', 'adv', 'results', 'dungeonEnd'].includes(room.phase)) return;
    const role = player.id === d.dmId ? 'dm' : d.adv[player.id] ? (d.adv[player.id].alive ? 'adventurer' : 'ghost') : null;
    const text = role && MESSAGES[role][i];
    if (!text) return;
    const now = Date.now();
    if (player.lastEmote && now - player.lastEmote < ROOM.EMOTE_COOLDOWN_MS) return;
    player.lastEmote = now;
    io.to(room.code).emit('emote', { id: player.id, text });
  });

  socket.on('whisper', ({ to, i, door } = {}, cb) => {
    const { room, player, d } = ctx(socket);
    if (!d || !canRoam(room.phase)) return reply(cb, { error: 'You can only whisper in the room.' });
    if (!d.adv[player.id] || !d.adv[to] || to === player.id || d.adv[to].left) return reply(cb, { error: 'Pick someone to whisper to.' });
    if (!nearEnough(d.pos[player.id], d.pos[to])) return reply(cb, { error: 'Walk right next to them first.' });
    let text = MESSAGES.huddle[i];
    if (!text) return reply(cb, { error: 'Pick a message.' });
    if (text.includes('{door}')) {
      if (!Number.isInteger(door) || door < 0 || door >= d.doorsCount) return reply(cb, { error: 'Pick a door.' });
      text = text.split('{door}').join(ROMAN[door]);
    }
    const now = Date.now();
    if (player.lastWhisper && now - player.lastWhisper < ROOM.WHISPER_COOLDOWN_MS) return reply(cb, { error: 'Easy, not so fast.' });
    player.lastWhisper = now;
    const target = room.players.find((p) => p.id === to);
    if (target && target.socketId) io.to(target.socketId).emit('whisper', { from: player.id, text });
    // everyone else only sees that the two of them are huddled
    io.to(room.code).emit('huddle', { a: player.id, b: to });
    reply(cb, { ok: true, text });
  });

  socket.on('guideDone', () => {
    const { room, player } = ctx(socket);
    if (!room || !player) return;
    player.guide = true;
    broadcast(room);
  });

  socket.on('getLog', (_, cb) => {
    const { room } = ctx(socket);
    if (!room) return reply(cb, { error: 'Not in a game.' });
    // the log holds traps and purchases, so it is only shared when none of it is still secret
    if (room.match && !['dungeonEnd', 'matchEnd'].includes(room.phase)) {
      return reply(cb, { error: 'The match log is available between dungeons.' });
    }
    const log = room.match ? room.match.log : room.lastLog;
    if (!log) return reply(cb, { error: 'No match log yet.' });
    reply(cb, { ok: true, log });
  });

  socket.on('toLobby', () => {
    const { room, player } = ctx(socket);
    if (!room || room.hostId !== player.id || room.phase !== 'matchEnd') return;
    room.lastLog = room.match.log;
    room.match = null;
    room.players = room.players.filter((p) => p.connected);
    setPhase(room, 'lobby', null);
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const { room, player } = ctx(socket);
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    if (room.hostId === player.id) {
      const next = room.players.find((p) => p.connected);
      if (next) room.hostId = next.id;
    }
    if (room.players.every((p) => !p.connected)) room.emptySince = Date.now();
    broadcast(room);
    if (room.phase === 'setup') checkSetupDone(room);
    if (room.phase === 'adv') checkAdvDone(room);
  });
});

// remove rooms nobody has been in for 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince && now - room.emptySince > 30 * 60 * 1000) {
      if (room.timer) clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
}, 60 * 1000);

// one bad message must never take the game down for everyone: log it and keep running
process.on('uncaughtException', (e) => console.error('Unexpected error (server kept running):', e));
process.on('unhandledRejection', (e) => console.error('Unexpected rejection (server kept running):', e));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Greed & Spite running on port ${PORT}`));

module.exports = { C, validateDM, damageFor };
