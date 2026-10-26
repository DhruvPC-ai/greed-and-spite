'use strict';
const socket = io();
const $app = document.getElementById('app');
const $modal = document.getElementById('modal');

/* ---------- storage (guarded) ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } },
};
let token = store.get('gs_token');
if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('gs_token', token); }

let S = null;
let clockOffset = 0;
let screen = null;
const ui = { name: store.get('gs_name') || '', code: '', dmKey: null, dm: null, advKey: null, adv: null, rules: false };

const EL = ['fire', 'water', 'earth', 'air'];
const CLUE = {
  fire: 'Warm air and scorch marks',
  water: 'Damp floor, steady dripping',
  earth: 'Loose gravel, a low rumble',
  air: 'A thin whistling draft',
  none: 'Quiet. Nothing unusual.',
};
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const VERB = { sprint: 'Sprint', walk: 'Walk', sneak: 'Sneak' };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const D = () => S && S.match && S.match.dungeon;
const cfg = () => S.config;
const pname = (id) => { const p = S.players.find((x) => x.id === id); return p ? p.name : '???'; };
const isHost = () => S && S.hostId === S.me;
const advOf = (id) => D().advs.find((a) => a.id === id);
const colorOf = (id) => {
  if (S.match) return Math.max(0, S.match.dmOrder.indexOf(id));
  return Math.max(0, S.players.findIndex((p) => p.id === id));
};

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 3200);
}
const ack = (r) => { if (r && r.error) toast(r.error); };

/* ---------- socket ---------- */
socket.on('connect', () => {
  const code = store.get('gs_code');
  if (code && ui.name) {
    socket.emit('join', { code, name: ui.name, token }, (r) => {
      if (r && r.error) { store.del('gs_code'); S = null; render(); }
    });
  }
});
let lastNeed = null;
socket.on('state', (v) => {
  S = v;
  clockOffset = v.now - Date.now();
  store.set('gs_code', v.code);
  syncLocal();
  const need = needsMe() ? `${S.phase}:${S.match.dIndex}:${D().round}` : null;
  if (need && need !== lastNeed) Sound.play('yourTurn');
  lastNeed = need;
  render();
});

// is this player expected to act in the current phase?
function needsMe() {
  const d = D();
  if (!d) return false;
  if (S.phase === 'setup') return d.role === 'adv';
  if (S.phase === 'dm') return d.role === 'dm';
  if (S.phase === 'adv') return d.role === 'adv' || d.role === 'ghost';
  return false;
}
function stillOwes() {
  const d = D();
  if (!needsMe()) return false;
  if (S.phase === 'setup') return !d.mine.setupReady;
  if (S.phase === 'adv' && d.role === 'adv') return !d.mine.action;
  if (S.phase === 'adv' && d.role === 'ghost') return !d.ghostDone;
  return true;
}
socket.on('kicked', () => { store.del('gs_code'); S = null; render(); toast('The host removed you from the game.'); });
socket.on('disconnect', () => toast('Connection lost. Reconnecting…'));

/* ---------- local drafts follow the server's round ---------- */
function syncLocal() {
  const d = D();
  if (!d) return;
  const key = `${S.match.dIndex}-${d.round}`;
  if (d.role === 'dm' && S.phase === 'dm' && ui.dmKey !== key) {
    ui.dmKey = key;
    const base = Math.floor(d.budget / d.doorsCount);
    ui.dm = Array.from({ length: d.doorsCount }, (_, i) => ({
      gold: base + (i === 0 ? d.budget - base * d.doorsCount : 0),
      tier: 'none', element: 'fire', illusion: 'honest',
    }));
    sendDraft();
  }
  if (ui.advKey !== key) {
    ui.advKey = key;
    ui.adv = { door: null, resting: false, approach: 'walk', armour: false, charm: '', lock: false, shove: '' };
  }
}
function draftForServer() {
  return { doors: ui.dm.map((x) => ({
    gold: x.gold,
    trap: x.tier === 'none' ? null : { tier: x.tier, element: x.element },
    illusion: x.illusion === 'honest' ? null : x.illusion,
  })) };
}
function sendDraft() { socket.emit('dmDraft', draftForServer()); }
function dmCost() {
  const c = cfg();
  return ui.dm.reduce((s, x) => s + (x.tier === 'none' ? 0 : c.TRAPS[x.tier].cost) + (x.illusion === 'honest' ? 0 : c.ILLUSION_COST), 0);
}

/* ---------- timer ---------- */
setInterval(() => {
  const el = document.getElementById('timer-val');
  const wrap = document.getElementById('timer');
  if (!el || !S) return;
  if (!S.deadline) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const left = Math.max(0, Math.ceil((S.deadline - (Date.now() + clockOffset)) / 1000));
  el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  wrap.classList.toggle('low', left <= 10);
  if (left <= 5 && left > 0 && left !== tickAt && stillOwes()) Sound.play('tick');
  tickAt = left;
}, 250);
let tickAt = null;

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  const want = !S ? 'home' : S.phase === 'lobby' ? 'lobby' : 'game';
  if (want === 'home') { $app.innerHTML = renderHome(); screen = 'home'; }
  else if (want === 'lobby') { $app.innerHTML = renderLobby(); screen = 'lobby'; }
  else {
    if (screen !== 'game') {
      $app.innerHTML = `
        <header class="bar" id="bar"></header>
        <div class="game">
          <section>
            <div class="stage-title" id="stage-title"></div>
            <div id="scene-slot"></div>
            <div id="panel"></div>
          </section>
          <aside id="side"></aside>
        </div>`;
      screen = 'game';
      Scene.mount(document.getElementById('scene-slot'));
    }
    document.getElementById('bar').innerHTML = renderBar();
    document.getElementById('stage-title').innerHTML = renderTitle();
    renderPanel();
    document.getElementById('side').innerHTML = renderSide();
    Scene.update(S, ui);
  }
  $modal.innerHTML = ui.rules ? renderRules() : '';
}
function renderPanel() {
  const el = document.getElementById('panel');
  if (el) el.innerHTML = panelHtml();
}
Scene.onChange(() => {
  if (!S || S.phase !== 'results') return;
  renderPanel();
  const side = document.getElementById('side');
  if (side) side.innerHTML = renderSide();
});

const soundBtn = () => `<button class="pbtn sm quiet" data-act="sound" aria-pressed="${!Sound.isMuted()}">Sound ${Sound.isMuted() ? 'off' : 'on'}</button>`;

/* ---------- home ---------- */
function renderHome() {
  const parade = [0, 1, 2, 3].map((i) => `<div class="sprite">${Sprites.adventurer(i, EL[i], 4)}</div>`).join('') +
    `<div class="sprite is-ghost" style="opacity:.8">${Sprites.ghost(4, 4)}</div>`;
  return `
  <main class="home">
    <h1 class="logo">Greed <span class="amp">&amp;</span><br>Spite</h1>
    <p class="tagline">One player guards the gold. Everyone else is on their own.</p>
    <div class="parade" aria-hidden="true">${parade}</div>
    <div class="win">
      <div class="field">
        <label for="name">Your name</label>
        <input type="text" id="name" maxlength="16" autocomplete="nickname" value="${esc(ui.name)}" data-input="name">
      </div>
      <button class="pbtn gold" data-act="create">Create a game</button>
      <p class="or">Or join a friend’s game</p>
      <div class="row">
        <input type="text" class="code-input" id="code" maxlength="4" placeholder="CODE" autocomplete="off" value="${esc(ui.code)}" data-input="code" aria-label="Game code">
        <button class="pbtn" data-act="join">Join</button>
      </div>
    </div>
    <button class="pbtn quiet sm" data-act="rules">How to play</button>
  </main>`;
}

/* ---------- lobby ---------- */
function renderLobby() {
  const c = cfg();
  const crowd = S.players.map((p, i) => `
    <div class="who">
      <div class="sprite">${Sprites.adventurer(i, null, 4)}</div>
      <span class="nm">${esc(p.name)}</span>
      <span class="row" style="gap:4px">
        ${p.id === S.hostId ? '<span class="tag host">Host</span>' : ''}
        ${p.id === S.me ? '<span class="tag">You</span>' : ''}
        ${!p.connected ? '<span class="tag">Away</span>' : ''}
      </span>
      ${isHost() && p.id !== S.me ? `<button class="pbtn quiet sm" data-act="kick" data-id="${p.id}">Remove</button>` : ''}
    </div>`).join('');
  const enough = S.players.length >= c.MIN_PLAYERS;
  const opts = [];
  for (let r = c.MIN_ROUNDS; r <= c.MAX_ROUNDS; r++) opts.push(`<option value="${r}" ${r === S.settings.rounds ? 'selected' : ''}>${r} rounds per dungeon</option>`);
  const paceName = { relaxed: 'Relaxed', normal: 'Normal', fast: 'Fast' };
  const paceOpts = Object.keys(c.PACE).map((k) => `<option value="${k}" ${k === S.settings.pace ? 'selected' : ''}>${paceName[k]} pace (${Math.round(c.TIME.adv * c.PACE[k])}s to choose)</option>`).join('');
  const minutes = Math.round((S.players.length * S.settings.rounds * (c.TIME.dm * 0.6 + c.TIME.adv * 0.8 + 12) * c.PACE[S.settings.pace]) / 60);
  return `
  <main class="lobby">
    <h1 class="logo">Greed <span class="amp">&amp;</span> Spite</h1>
    <div class="win">
      <div class="muted">Friends join on this site with the code</div>
      <div class="room-code">${S.code}</div>
    </div>
    <div class="win">
      <div class="win-title">The party <span class="muted">${S.players.length} of ${c.MAX_PLAYERS}</span></div>
      <div class="tavern">${crowd}</div>
      <p class="muted small">Everyone plays dungeon master once, in this order. You need ${c.MIN_PLAYERS} to ${c.MAX_PLAYERS} players.</p>
      ${isHost() ? `
        <div class="row" style="margin-top:12px">
          <select data-change="rounds" aria-label="Rounds per dungeon">${opts.join('')}</select>
          <select data-change="pace" aria-label="Pace">${paceOpts}</select>
        </div>
        <p class="muted small" style="margin:10px 0">About ${minutes} minutes with ${S.players.length} players. First time? Try 3 rounds.</p>
        <button class="pbtn gold" data-act="start" ${enough ? '' : 'disabled'}>Start the game</button>
        ${enough ? '' : `<p class="muted small" style="margin-top:8px">Waiting for at least ${c.MIN_PLAYERS} players.</p>`}`
      : `<p>${S.settings.rounds} rounds per dungeon, ${paceName[S.settings.pace].toLowerCase()} pace. About ${minutes} minutes. Waiting for ${esc(pname(S.hostId))} to start.</p>`}
    </div>
    ${S.hasLastLog ? `<div class="win"><div class="win-title">Last match</div>${logButtons()}</div>` : ''}
    <div class="row">
      <button class="pbtn quiet sm" data-act="rules">How to play</button>
      <button class="pbtn quiet sm" data-act="leave">Leave game</button>
      ${soundBtn()}
    </div>
  </main>`;
}

/* ---------- bar & title ---------- */
function renderBar() {
  const d = D();
  const m = S.match;
  let chips = '';
  if (d && S.phase !== 'matchEnd') {
    chips += `<span class="chip">Dungeon <b>${m.dIndex + 1}</b>/${m.total}</span>`;
    if (d.round > 0) chips += `<span class="chip">Round <b>${d.round}</b>/${d.rounds}</span>`;
    chips += `<span class="chip">Pot <b class="gold">${d.P}</b></span>`;
  }
  return `
    <span class="brand">Greed &amp; Spite</span>
    ${chips}
    <span class="spacer"></span>
    <span class="timer" id="timer" hidden>${Sprites.icon('hourglass', 2)}<span id="timer-val"></span></span>
    ${soundBtn()}
    <button class="pbtn sm quiet" data-act="rules">Rules</button>`;
}

function renderTitle() {
  const d = D();
  const t = (h, p) => `<h2>${h}</h2>${p ? `<p>${p}</p>` : ''}`;
  if (S.phase === 'matchEnd') return t('The hoard is counted', '');
  if (S.phase === 'dungeonEnd') return t(`${esc(pname(d.dmId))}’s dungeon is done`, '');
  if (S.phase === 'setup') return t(d.role === 'dm' ? 'You are the dungeon master' : 'Gear up', d.role === 'dm' ? 'The adventurers are getting ready.' : 'Pick your element and visit the shop.');
  if (S.phase === 'dm') return t(d.role === 'dm' ? 'Set your traps' : `${esc(pname(d.dmId))} is setting traps`, d.role === 'dm' ? 'The doors above preview what adventurers will see.' : 'Talk it over. Lie if it helps.');
  if (S.phase === 'adv') {
    if (d.role === 'dm') return t('The adventurers are choosing', '');
    if (d.role === 'ghost') return t('You are a ghost', 'You see every real trap.');
    return t('Choose a door', 'Tap a door, then choose how you go in.');
  }
  if (S.phase === 'results') return t(`Round ${d.round}: the doors open`, '');
  return '';
}

/* ---------- side ---------- */
function renderSide() {
  const d = D();
  if (!d) return '';
  if (S.phase === 'matchEnd') return `<div class="win"><div class="win-title">Score by dungeon</div>${renderHistory()}</div>`;
  const hiding = S.phase === 'results' && d.lastResult && Scene.isPlaying();
  const view = d.advs.map((a) => {
    if (!hiding) return a;
    const b = d.lastResult.before[a.id];
    return { ...a, hp: b.hp, gold: b.gold, alive: b.hp > 0 };
  });
  const rows = view.map((a) => {
    const p = S.players.find((x) => x.id === a.id);
    const pct = Math.max(0, Math.round((a.hp / cfg().START_HP) * 100));
    const cls = pct <= 30 ? 'low' : pct <= 60 ? 'mid' : '';
    let tag = '';
    if (!p.connected) tag = '<span class="tag">Away</span>';
    else if ((S.phase === 'setup' || S.phase === 'adv') && a.ready) tag = '<span class="tag ready">Ready</span>';
    return `<li class="${a.id === S.me ? 'me' : ''}">
      <span class="portrait">${a.alive ? Sprites.portrait(colorOf(a.id), a.affinity, 3) : Sprites.ghost(colorOf(a.id), 3).split('</svg>')[0] + '</svg>'}</span>
      <span class="pname"><span class="${a.alive ? '' : 'ghostname'}">${esc(pname(a.id))}</span>${tag}</span>
      <span class="stats">
        ${a.alive ? `<span class="hpbar" title="${a.hp} HP"><b class="${cls}" style="width:${pct}%"></b></span><span>${a.hp}</span>` : '<span class="ghostname">Ghost</span>'}
        <span class="gold">${Sprites.icon('coin', 2)} ${a.gold}</span>
        ${a.affinity ? `<span class="el-${a.affinity}">${cap(a.affinity)}</span>` : ''}
      </span>
    </li>`;
  }).join('');
  const m = S.match;
  const totals = m.history.length ? `<div class="win"><div class="win-title">Match scores</div><table class="scores"><tbody>${[...m.dmOrder].sort((a, b) => m.totals[b] - m.totals[a]).map((id) => `<tr><td>${esc(pname(id))}</td><td class="num">${m.totals[id].toFixed(1)}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `
    <div class="win">
      <div class="win-title">The party</div>
      <p class="small" style="margin-bottom:6px"><span class="tag host">DM</span> ${esc(pname(d.dmId))}</p>
      <ul class="party">${rows}</ul>
    </div>
    ${totals}`;
}

/* ---------- panel by phase ---------- */
function panelHtml() {
  const d = D();
  if (!d && S.phase !== 'matchEnd') return '';
  if (S.phase === 'matchEnd') return renderMatchEnd();
  if (S.phase === 'dungeonEnd') return renderDungeonEnd();
  if (S.phase === 'setup') return renderSetup();
  if (S.phase === 'dm') return d.role === 'dm' ? renderDmEditor() : `<div class="win"><p style="margin:0">${d.role === 'ghost' ? 'Once the doors are set, you’ll see every trap.' : 'Watch the doors. When they’re ready, choose fast.'}</p></div>`;
  if (S.phase === 'adv') return d.role === 'dm' ? renderDmWatch() : d.role === 'ghost' ? renderGhost() : renderAdventurer();
  if (S.phase === 'results') return renderResults();
  return '';
}

/* ----- setup ----- */
function renderSetup() {
  const d = D();
  const c = cfg();
  if (d.role === 'dm') {
    return `<div class="win">
      <p>This dungeon has <b>${d.rounds}</b> rounds and <b>${d.doorsCount}</b> doors per round. The pot is <span class="gold">${d.P} gold</span>.</p>
      <p class="muted" style="margin:0">Every coin the adventurers don’t hold at the end is yours, including what they spend in the shop. Each round you get gold to hide and mana for traps. Unspent mana carries over.</p>
    </div>`;
  }
  const mine = d.mine;
  const aff = EL.map((e) => `
    <button class="pbtn ${mine.affinity === e ? 'on' : ''}" data-act="aff" data-el="${e}" ${mine.setupReady ? 'disabled' : ''}>
      ${Sprites.icon(e, 2)} <span class="el-${e}">${cap(e)}</span>
      <span class="sub">Resist ${cap(e)}, weak to ${cap(c.WEAK_TO[e])}</span>
    </button>`).join('');
  return `
    <div class="win"><div class="win-title">Your element <span class="muted">Everyone will see it</span></div><div class="seg">${aff}</div></div>
    ${renderShop()}
    <div class="win">
      ${mine.setupReady ? '<div class="note" style="margin:0">You’re ready. Waiting for the others.</div>' :
      `<button class="pbtn gold" data-act="setupReady" ${mine.affinity ? '' : 'disabled'}>I’m ready</button>
       ${mine.affinity ? '' : '<span class="muted small" style="margin-left:10px">Pick an element first.</span>'}`}
    </div>`;
}

/* ----- shop ----- */
function renderShop() {
  const d = D();
  const c = cfg();
  const mine = d.mine;
  const me = advOf(S.me);
  const items = Object.entries(c.SHOP).map(([k, it]) => {
    const owned = k === 'potion' ? mine.potions : mine.inv[k];
    return `<div class="item">
      <div class="top"><span>${it.name}</span><span class="gold">${Sprites.icon('coin', 2)} ${it.cost}</span></div>
      <p>${it.text}</p>
      <div class="row">
        <button class="pbtn sm" data-act="buy" data-item="${k}" ${me.gold < it.cost ? 'disabled' : ''}>Buy</button>
        <span class="muted small">You have ${owned}</span>
        ${k === 'potion' && mine.potions > 0 ? `<button class="pbtn sm" data-act="drink" ${me.hp >= c.START_HP ? 'disabled' : ''}>Drink</button>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<div class="win"><div class="win-title">Shop <span class="muted">You have <span class="gold">${me.gold}</span> gold and ${me.hp} HP. Spent gold goes to the DM.</span></div><div class="grid2">${items}</div></div>`;
}

/* ----- DM editor ----- */
function renderDmEditor() {
  const d = D();
  const c = cfg();
  const placed = ui.dm.reduce((s, x) => s + x.gold, 0);
  const left = d.budget - placed;
  const cost = dmCost();
  const mana = d.dm.mana;
  const cards = ui.dm.map((x, i) => {
    const tiers = ['none', 'minor', 'major', 'deadly'].map((t) => `
      <button class="pbtn sm ${x.tier === t ? 'on' : ''}" data-act="dmTier" data-i="${i}" data-v="${t}">
        ${t === 'none' ? 'No trap' : `${c.TRAPS[t].name}<span class="sub">${c.TRAPS[t].dmg} dmg, ${c.TRAPS[t].cost} mana</span>`}
      </button>`).join('');
    const els = EL.map((e) => `<button class="pbtn sm ${x.element === e ? 'on' : ''}" data-act="dmEl" data-i="${i}" data-v="${e}">${Sprites.icon(e, 2)} <span class="el-${e}">${cap(e)}</span></button>`).join('');
    const ill = [['honest', 'Honest clue'], ['none', 'Fake: nothing'], ...EL.map((e) => [e, `Fake: ${cap(e)}`])]
      .map(([v, l]) => `<option value="${v}" ${x.illusion === v ? 'selected' : ''}>${l}${v !== 'honest' ? ` (${c.ILLUSION_COST} mana)` : ''}</option>`).join('');
    return `<div class="dm-door">
      <h4>Door ${ROMAN[i]}</h4>
      <div class="stepper">
        <button class="pbtn sm" data-act="dmGold" data-i="${i}" data-v="-5" aria-label="5 less gold on door ${ROMAN[i]}">−5</button>
        <span class="val">${x.gold}</span>
        <button class="pbtn sm" data-act="dmGold" data-i="${i}" data-v="5" aria-label="5 more gold on door ${ROMAN[i]}">+5</button>
        <span class="muted small">gold</span>
      </div>
      <div class="seg">${tiers}</div>
      ${x.tier !== 'none' ? `<div class="seg">${els}</div>` : ''}
      <label class="small row">Clue <select data-change="dmIll" data-i="${i}">${ill}</select></label>
    </div>`;
  }).join('');
  const ok = left === 0 && cost <= mana && ui.dm.every((x) => x.gold >= c.MIN_DOOR_GOLD);
  return `<div class="win">
      <div class="totals">
        <span>Gold to place <b class="${left === 0 ? 'gold' : ''}" style="${left < 0 ? 'color:var(--blood)' : ''}">${left}</b></span>
        <span>${Sprites.icon('mana', 2)} Mana <b style="${cost > mana ? 'color:var(--blood)' : ''}">${cost}</b> of ${mana}</span>
      </div>
      <p class="muted small">Hide all ${d.budget} gold, at least ${c.MIN_DOOR_GOLD} per door. Adventurers see the gold and the clue, never the trap. Gold nobody takes stays yours.</p>
      <div class="grid2">${cards}</div>
      <div class="row" style="margin-top:16px">
        <button class="pbtn gold" data-act="dmSubmit" ${ok ? '' : 'disabled'}>Lock in the dungeon</button>
        <span class="muted small">${left !== 0 ? `Place ${left > 0 ? left + ' more' : -left + ' less'} gold.` : cost > mana ? 'Not enough mana.' : 'If time runs out, your current setup is used.'}</span>
      </div>
    </div>`;
}

function renderDmWatch() {
  const d = D();
  const waiting = d.advs.filter((a) => !a.ready).map((a) => esc(pname(a.id)));
  return `<div class="win"><p style="margin:0">${waiting.length ? `Still choosing: ${waiting.join(', ')}.` : 'Everyone has chosen.'} Your traps are shown above the doors. Only you and the ghosts can see them.</p></div>`;
}

/* ----- ghost ----- */
function renderGhost() {
  const d = D();
  const c = cfg();
  const living = d.advs.filter((a) => a.alive);
  const btns = living.map((a) => `<button class="pbtn ${d.myHaunt === a.id && d.ghostDone ? 'on' : ''}" data-act="haunt" data-id="${a.id}">${esc(pname(a.id))}<span class="sub">${a.gold} gold, ${a.hp} HP</span></button>`).join('');
  return `<div class="win">
    <div class="win-title">Haunt someone</div>
    <p class="muted">If a trap hurts them this round, you steal ${Math.round(c.HAUNT_STEAL * 100)}% of their gold. Nobody can see who you haunt. You can talk, and you can lie.</p>
    <div class="seg">${btns}<button class="pbtn ${d.ghostDone && !d.myHaunt ? 'on' : ''}" data-act="haunt" data-id="">Nobody</button></div>
    ${d.ghostDone ? `<div class="note">${d.myHaunt ? `Haunting ${esc(pname(d.myHaunt))}.` : 'Haunting nobody.'} You can change this until time runs out.</div>` : ''}
  </div>`;
}

/* ----- adventurer ----- */
function renderAdventurer() {
  const d = D();
  const c = cfg();
  const mine = d.mine;
  const a = ui.adv;
  const sel = a.door !== null ? d.doors[a.door] : null;
  const approaches = ['sprint', 'walk', 'sneak'].map((k) => {
    const ap = c.APPROACH[k];
    const tip = { sprint: 'First in. Most gold, most danger.', walk: 'The middle way.', sneak: 'Last in. Little gold, little danger.' }[k];
    return `<button class="pbtn ${a.approach === k ? 'on' : ''}" data-act="approach" data-v="${k}">${VERB[k]}<span class="sub">${ap.bags} ${ap.bags > 1 ? 'bags' : 'bag'}, ×${ap.mult} damage if first. ${tip}</span></button>`;
  }).join('');
  const others = d.advs.filter((x) => x.alive && x.id !== S.me);
  const items = [];
  if (mine.inv.armour > 0) items.push(`<button class="pbtn ${a.armour ? 'on' : ''}" data-act="tog" data-v="armour">Armour (${mine.inv.armour})<span class="sub">Half damage</span></button>`);
  if (mine.inv.lock > 0) items.push(`<button class="pbtn ${a.lock ? 'on' : ''}" data-act="tog" data-v="lock">Lock (${mine.inv.lock})<span class="sub">All the gold, ×${c.LOCK_MULT} damage</span></button>`);
  if (mine.inv.charm > 0) items.push(`<label class="item">Charm (${mine.inv.charm})<select data-change="charm"><option value="">Don’t use</option>${EL.map((e) => `<option value="${e}" ${a.charm === e ? 'selected' : ''}>Resist ${cap(e)}</option>`).join('')}</select></label>`);
  if (mine.inv.shove > 0) items.push(`<label class="item">Shove (${mine.inv.shove})<select data-change="shove"><option value="">Don’t use</option>${others.map((o) => `<option value="${o.id}" ${a.shove === o.id ? 'selected' : ''}>Shove ${esc(pname(o.id))}</option>`).join('')}</select></label>`);
  const lensFor = (i) => mine.lens.find((x) => x.door === i);
  const lens = mine.inv.lens > 0 ? `<div class="win"><div class="win-title">Lens (${mine.inv.lens}) <span class="muted">Look behind one door. Only you see it.</span></div><div class="seg">${d.doors.map((_, i) => `<button class="pbtn sm" data-act="lens" data-i="${i}" ${lensFor(i) ? 'disabled' : ''}>Door ${ROMAN[i]}</button>`).join('')}</div></div>` : '';
  const act = mine.action;
  let locked = '';
  if (act) {
    if (act.type === 'rest') locked = 'Locked in: Rest.';
    else {
      const ex = [act.armour && 'Armour', act.lock && 'Lock', act.charm && `Charm (${cap(act.charm)})`, act.shove && `Shove ${pname(act.shove)}`].filter(Boolean);
      locked = `Locked in: ${VERB[act.approach]} through door ${ROMAN[act.door]}${ex.length ? ' with ' + ex.join(', ') : ''}.`;
    }
  }
  return `<div class="win">
      <div class="win-title">${sel ? `Door ${ROMAN[a.door]} <span class="muted"><span class="gold">${sel.gold} gold</span>. <span class="el-${sel.clue}">${CLUE[sel.clue]}</span></span>` : 'Tap a door above'}</div>
      <div class="seg">${approaches}</div>
      ${items.length ? `<div class="win-title" style="margin-top:14px">Items</div><div class="seg">${items.join('')}</div>` : ''}
      ${act ? `<div class="note">${esc(locked)} You can change it until time runs out.</div>` : ''}
      <div class="row" style="margin-top:14px">
        <button class="pbtn gold" data-act="lockIn" ${sel ? '' : 'disabled'}>${sel ? `${VERB[a.approach]} through door ${ROMAN[a.door]}` : 'Pick a door first'}</button>
        <button class="pbtn" data-act="rest">Rest by the fire<span class="sub">+${c.REST_HEAL} HP, no gold</span></button>
      </div>
      <p class="muted small" style="margin:12px 0 0">Only the first ones in spring the trap. A room needs ${c.ROOM_BAGS} bags to empty; with more, the gold is split by bags.</p>
    </div>
    ${lens}
    ${renderShop()}`;
}

/* ----- results ----- */
function renderResults() {
  const d = D();
  const r = d.lastResult;
  const lines = [];
  if (r.dmTimedOut) lines.push('<p class="muted">The DM ran out of time, so the dungeon set itself up.</p>');
  r.doors.forEach((x) => lines.push(`<p><span class="dn">${ROMAN[x.index]}</span>${esc(x.lines.join(' '))}</p>`));
  r.rests.forEach((x) => lines.push(`<p>${esc(pname(x.id))} ${x.auto ? 'didn’t choose in time and rested' : 'rested by the fire'}${x.healed ? ` (+${x.healed} HP)` : ''}.</p>`));
  r.haunts.forEach((x) => lines.push(`<p class="ghostname">${esc(pname(x.ghost))} haunted ${esc(pname(x.target))}${x.stolen ? ` and stole ${x.stolen} gold.` : ', who took no trap damage.'}</p>`));
  r.deaths.forEach((x) => lines.push(`<p style="color:var(--blood)">${esc(pname(x.id))} died, dropped ${x.dropped} gold, and rose as a ghost.</p>`));
  const last = d.round >= d.rounds || d.advs.every((a) => !a.alive);
  const cont = isHost()
    ? `<button class="pbtn gold" data-act="continue">${last ? 'Count the gold' : 'Next round'}</button>`
    : `<span class="muted small">${esc(pname(S.hostId))} continues, or it moves on when time runs out.</span>`;
  const playing = Scene.isPlaying();
  return `<div class="win">
    <div class="row" style="margin-bottom:12px">
      ${playing ? '<button class="pbtn" data-act="skip">Skip</button>' : '<button class="pbtn" data-act="replay">Replay</button>'}
      ${cont}
    </div>
    ${playing ? '<p class="muted" style="margin:0">The doors are opening…</p>' : `<div class="log">${lines.join('')}</div>`}
  </div>`;
}

/* ----- dungeon end ----- */
function renderDungeonEnd() {
  const d = D();
  const sc = d.scores;
  const N = d.advIds.length;
  const rows = Object.entries(sc).sort((a, b) => b[1].score - a[1].score).map(([id, s]) => `
    <tr><td>${esc(pname(id))}</td>
    <td>${s.role === 'dm' ? 'DM' : s.alive ? 'Adventurer' : '<span class="ghostname">Ghost</span>'}</td>
    <td class="num">${s.held}</td>
    <td class="num"><b>${s.score.toFixed(1)}</b></td></tr>`).join('');
  const lastD = S.match.dIndex + 1 >= S.match.total;
  return `${renderAwards(d)}<div class="win">
    <div class="win-title">Dungeon scores <span class="muted">Pot ${d.P} gold</span></div>
    <div class="tablewrap"><table class="scores">
      <thead><tr><th>Player</th><th>Role</th><th class="num">Gold</th><th class="num">Score</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="muted small" style="margin-top:10px">Adventurer score = gold held × ${N} ÷ ${d.P} × 100. DM score = gold not held by adventurers ÷ ${d.P} × 100.</p>
    ${isHost() ? `<button class="pbtn gold" data-act="continue">${lastD ? 'Final scores' : `Next dungeon (DM: ${esc(pname(S.match.dmOrder[S.match.dIndex + 1]))})`}</button>`
      : `<span class="muted">Waiting for ${esc(pname(S.hostId))} to continue.</span>`}
  </div>
  <div class="win"><div class="win-title">Match log <span class="muted">Every round so far, for tuning the game</span></div>${logButtons()}</div>`;
}

const AWARD_ICON = { greediest: 'coin', canary: 'heart', spiteful: 'lock', daredevil: 'fire', coward: 'zz', untouchable: 'crown', trapmaster: 'skull' };
function renderAwards(d) {
  if (!d.awards || !d.awards.length) return '';
  const cards = d.awards.map((w) => {
    const icon = w.key === 'robber' ? Sprites.ghost(4, 3).split('</svg>')[0] + '</svg>' : Sprites.icon(AWARD_ICON[w.key] || 'crown', 4);
    const names = w.players.map((id) => esc(pname(id)));
    return `<div class="award">
      <div class="award-icon">${icon}</div>
      <div><div class="award-title">${w.title}</div>
      <div class="award-who">${names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]}</div>
      <div class="muted small">${esc(w.text)}</div></div>
    </div>`;
  }).join('');
  return `<div class="win"><div class="win-title">Awards</div><div class="awards">${cards}</div></div>`;
}

function logButtons() {
  return `<div class="row"><button class="pbtn sm" data-act="log" data-v="txt">Download log (text)</button><button class="pbtn sm quiet" data-act="log" data-v="json">Download log (JSON)</button></div>`;
}

/* ----- match end ----- */
function renderHistory() {
  const m = S.match;
  const sorted = [...m.dmOrder].sort((a, b) => m.totals[b] - m.totals[a]);
  return `<div class="tablewrap"><table class="scores">
    <thead><tr><th>Player</th>${m.history.map((h, i) => `<th class="num" title="DM: ${esc(pname(h.dmId))}">${ROMAN[i] || i + 1}</th>`).join('')}</tr></thead>
    <tbody>${sorted.map((id) => `<tr><td>${esc(pname(id))}</td>${m.history.map((h) => `<td class="num ${h.dmId === id ? 'gold' : ''}">${h.scores[id] ? h.scores[id].score.toFixed(1) : '–'}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div><p class="muted small" style="margin-top:8px">Gold numbers are the dungeon each player ran as DM.</p>`;
}
function renderMatchEnd() {
  const m = S.match;
  const sorted = [...m.dmOrder].sort((a, b) => m.totals[b] - m.totals[a]);
  const top = m.totals[sorted[0]];
  const winners = sorted.filter((id) => m.totals[id] === top).map((id) => esc(pname(id)));
  const names = winners.length > 1 ? winners.slice(0, -1).join(', ') + ' and ' + winners[winners.length - 1] : winners[0];
  const place = (id) => 1 + sorted.filter((x) => m.totals[x] > m.totals[id]).length;
  return `<div class="win">
    <div class="winner">${names} ${winners.length > 1 ? 'share the hoard' : 'takes the hoard'}</div>
    <div class="tablewrap"><table class="scores">
      <thead><tr><th>Rank</th><th>Player</th><th class="num">Total</th></tr></thead>
      <tbody>${sorted.map((id) => `<tr><td>${place(id)}</td><td>${esc(pname(id))}</td><td class="num"><b>${m.totals[id].toFixed(1)}</b></td></tr>`).join('')}</tbody>
    </table></div>
    <div style="margin-top:14px">${isHost() ? '<button class="pbtn gold" data-act="toLobby">Back to the lobby</button>' : `<span class="muted">${esc(pname(S.hostId))} can take everyone back to the lobby.</span>`}</div>
  </div>
  <div class="win"><div class="win-title">Match log <span class="muted">Every round, for tuning the game</span></div>${logButtons()}</div>`;
}

/* ----- rules ----- */
function renderRules() {
  return `<div class="modal" data-act="closeRules"><div class="win" role="dialog" aria-label="How to play" data-stop="1">
    <div class="row" style="justify-content:space-between"><h2>How to play</h2><button class="pbtn sm" data-act="closeRules">Close</button></div>
    <p style="margin-top:10px">One player is the dungeon master. Everyone else is a greedy adventurer, out for themselves. Everyone takes one turn as DM. Highest total score wins.</p>
    <h3>Each round</h3>
    <ul>
      <li>The DM hides gold behind the doors and buys traps with mana. Every trap has an element.</li>
      <li>Adventurers see each door’s gold and a clue. A trapped door shows its real element; an empty door shows nothing. The DM can pay for an illusion to fake either.</li>
      <li>Each adventurer secretly picks a door and how to go in, or rests by the fire (+10 HP). Then the doors open.</li>
    </ul>
    <h3>Going in</h3>
    <ul>
      <li>Sprint: 3 bags, ×1.5 damage if first in. Walk: 2 bags, ×1. Sneak: 1 bag, ×0.5.</li>
      <li>Only the fastest group into a room springs the trap. Anyone slower behind them is safe.</li>
      <li>A room needs 3 bags to empty. With more than 3 bags, gold splits by bags. With fewer, the rest stays with the DM.</li>
    </ul>
    <h3>Elements</h3>
    <p>Your element halves damage from that element and adds 50% from the one that beats it. Water beats Fire, Fire beats Air, Air beats Earth, Earth beats Water.</p>
    <h3>Items (single use, shop always open)</h3>
    <ul>
      <li>Potion: +40 HP. Armour: half damage this round. Charm: resist one element this round.</li>
      <li>Lens: see the real trap behind one door, only you.</li>
      <li>Lock: you enter alone and take all the gold; anyone else on that door is locked out. You take ×2.5 damage.</li>
      <li>Shove: if your target picks your door, they spring the trap alone at ×1.5. Two shoves on each other: both go in.</li>
    </ul>
    <h3>Death and ghosts</h3>
    <p>At 0 HP you drop half your gold and become a ghost. Ghosts see every trap and secretly haunt one adventurer each round. If a trap hurts that adventurer, the ghost steals 25% of their gold.</p>
    <h3>Scoring</h3>
    <p>Every coin ends with an adventurer or the DM; gold spent in the shop goes to the DM. Adventurer score = gold held × number of adventurers ÷ pot × 100. DM score = gold not held by adventurers ÷ pot × 100. If the adventurers end up holding half the pot between them, the DM ties the average adventurer.</p>
  </div></div>`;
}

/* ============================================================
   MATCH LOG
   ============================================================ */
function downloadLog(fmt) {
  socket.emit('getLog', null, (r) => {
    if (!r || r.error) return toast((r && r.error) || 'Could not get the log.');
    const log = r.log;
    const stamp = log.started.slice(0, 16).replace(/[:T]/g, '-');
    const isJson = fmt === 'json';
    const blob = new Blob([isJson ? JSON.stringify(log, null, 2) : formatLog(log)], { type: isJson ? 'application/json' : 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `greed-and-spite-${stamp}.${isJson ? 'json' : 'txt'}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 3000);
  });
}

function formatLog(log) {
  const out = [];
  const L = (s = '') => out.push(s);
  const count = (arr) => Object.entries(arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  L('GREED & SPITE: MATCH LOG');
  L(`Started ${new Date(log.started).toLocaleString()}${log.finished ? `, finished ${new Date(log.finished).toLocaleString()}` : ''}`);
  L(`Players: ${log.players.join(', ')}`);
  L(`Settings: ${log.settings.rounds} rounds per dungeon, ${log.settings.pace} pace`);
  L(`Rules: ${log.config.startHp} HP and ${log.config.startGold} gold to start. Traps: ${Object.values(log.config.traps).map((t) => `${t.name} ${t.dmg} dmg for ${t.cost} mana`).join(', ')}. Illusion ${log.config.illusionCost} mana.`);
  L(`Shop: ${Object.entries(log.config.shop).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (log.totals) {
    L();
    L('TOTALS');
    Object.entries(log.totals).sort((x, y) => y[1] - x[1]).forEach(([n, v]) => L(`  ${n.padEnd(16)} ${v.toFixed(1)}`));
  }
  for (const dg of log.dungeons) {
    L();
    L('='.repeat(60));
    L(`DUNGEON ${dg.dungeon}   DM: ${dg.dm}   Pot: ${dg.pot} gold   Doors per round: ${dg.doorsPerRound}`);
    L(`Adventurers: ${dg.adventurers.map((n) => `${n}${dg.affinities[n] ? ` (${dg.affinities[n]})` : ''}`).join(', ')}`);
    const choices = dg.rounds.flatMap((r) => (r.choices || []).map((c) => c.choice));
    const traps = dg.rounds.flatMap((r) => r.doors.filter((x) => x.trap).map((x) => x.trap.split(' ')[0]));
    const illusions = dg.rounds.reduce((s, r) => s + r.doors.filter((x) => x.illusion !== null).length, 0);
    const sprung = dg.rounds.reduce((s, r) => s + (r.outcome || []).filter((o) => o.sprangTrap.length).length, 0);
    const bought = dg.shop.filter((e) => e.bought);
    const deaths = dg.rounds.reduce((s, r) => s + (r.deaths || []).length, 0);
    L();
    L('Summary');
    if (dg.scores) {
      const adv = Object.values(dg.scores).filter((x) => x.role === 'adv');
      const held = adv.reduce((s, x) => s + x.goldHeld, 0);
      const dm = Object.values(dg.scores).find((x) => x.role === 'dm');
      L(`  Adventurers ended holding ${held} of ${dg.pot} gold (${Math.round((held / dg.pot) * 100)}%).`);
      L(`  DM score ${dm.score.toFixed(1)}; adventurer average ${(adv.reduce((s, x) => s + x.score, 0) / adv.length).toFixed(1)}, best ${Math.max(...adv.map((x) => x.score)).toFixed(1)}.`);
    }
    L(`  Choices: ${count(choices)}`);
    L(`  Items bought: ${count(bought.map((e) => e.bought))} (${bought.reduce((s, e) => s + e.cost, 0)} gold spent)`);
    L(`  Traps placed: ${count(traps)}; illusions ${illusions}; traps sprung ${sprung}; deaths ${deaths}`);
    for (const r of dg.rounds) {
      L();
      L(`Round ${r.round}   ${r.goldBudget} gold to hide, DM had ${r.manaAvailable} mana and spent ${r.manaSpent}${r.dmTimedOut ? ' (DM timed out)' : ''}`);
      r.doors.forEach((x) => L(`  Door ${x.door}: ${x.gold} gold, ${x.trap ? x.trap + ' trap' : 'no trap'}, clue shown: ${x.clueShown}${x.illusion !== null ? ' (illusion)' : ''}`));
      if (r.choices) {
        L('  Choices:');
        r.choices.forEach((c) => L(`    ${c.player}: ${c.choice}${c.door ? ` into door ${c.door}` : ''}${c.items && c.items.length ? ` [${c.items.join(', ')}]` : ''}`));
        L('  What happened:');
        r.outcome.forEach((o) => L(`    ${o.door}: ${o.story}`));
        r.haunts.forEach((h) => L(`    Ghost ${h.ghost} haunted ${h.target}${h.stolen ? ` and stole ${h.stolen}` : ' (no damage, nothing stolen)'}`));
        r.deaths.forEach((x) => L(`    ${x.player} died and dropped ${x.dropped} gold`));
        L(`  After: ${Object.entries(r.after).map(([n, v]) => `${n} ${v.alive ? v.hp + ' HP' : 'ghost'}, ${v.gold} gold`).join('; ')}`);
      }
      const shop = dg.shop.filter((e) => e.round === r.round && e.phase !== 'setup');
      if (shop.length) L(`  Shop and items: ${shop.map(shopLine).join('; ')}`);
    }
    const setupShop = dg.shop.filter((e) => e.phase === 'setup');
    if (setupShop.length) { L(); L(`Bought before round 1: ${setupShop.map(shopLine).join('; ')}`); }
    if (dg.scores) {
      L();
      L('Scores');
      Object.entries(dg.scores).sort((x, y) => y[1].score - x[1].score).forEach(([n, v]) => L(`  ${n.padEnd(16)} ${v.role === 'dm' ? 'DM ' : 'adv'}  ${String(v.goldHeld).padStart(5)} gold  ${v.score.toFixed(1)}`));
    }
    if (dg.awards && dg.awards.length) {
      L();
      L('Awards');
      dg.awards.forEach((w) => L(`  ${w.title}: ${w.players.join(', ')} (${w.text})`));
    }
  }
  return out.join('\n') + '\n';
}
function shopLine(e) {
  if (e.bought) return `${e.player} bought ${e.bought} (${e.cost})`;
  if (e.drank) return `${e.player} drank a potion (${e.hpBefore} to ${e.hpAfter} HP)`;
  if (e.usedLens) return `${e.player} used a lens on door ${e.usedLens} and saw ${e.saw}`;
  return '';
}

/* ============================================================
   EVENTS
   ============================================================ */
document.addEventListener('input', (e) => {
  const k = e.target.dataset.input;
  if (k === 'name') ui.name = e.target.value;
  if (k === 'code') { ui.code = e.target.value.toUpperCase(); e.target.value = ui.code; }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.rules) { ui.rules = false; render(); }
  if (e.key === 'Enter' && e.target.dataset.input === 'code') doJoin();
});
function doJoin() {
  if (!ui.name.trim()) return toast('Enter your name first.');
  store.set('gs_name', ui.name.trim());
  socket.emit('join', { code: ui.code, name: ui.name.trim(), token }, ack);
}
document.addEventListener('change', (e) => {
  const k = e.target.dataset.change;
  if (!k) return;
  const v = e.target.value;
  if (k === 'rounds') socket.emit('settings', { rounds: Number(v) });
  if (k === 'pace') socket.emit('settings', { pace: v });
  if (k === 'dmIll') { ui.dm[Number(e.target.dataset.i)].illusion = v; sendDraft(); render(); }
  if (k === 'charm') { ui.adv.charm = v; render(); }
  if (k === 'shove') { ui.adv.shove = v; render(); }
});
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if (t.dataset.act === 'closeRules' && e.target.closest('[data-stop]') && !e.target.closest('button')) return;
  const act = t.dataset.act;
  const i = t.dataset.i !== undefined ? Number(t.dataset.i) : null;
  const v = t.dataset.v;
  switch (act) {
    case 'create':
      if (!ui.name.trim()) return toast('Enter your name first.');
      store.set('gs_name', ui.name.trim());
      socket.emit('create', { name: ui.name.trim(), token }, ack);
      break;
    case 'join': doJoin(); break;
    case 'leave': socket.emit('leave'); store.del('gs_code'); S = null; render(); break;
    case 'kick': socket.emit('kick', { pid: t.dataset.id }); break;
    case 'start': socket.emit('start', null, ack); break;
    case 'rules': ui.rules = true; render(); break;
    case 'closeRules': ui.rules = false; render(); break;
    case 'aff': socket.emit('affinity', { element: t.dataset.el }); break;
    case 'setupReady': socket.emit('setupReady'); Sound.play('lockIn'); break;
    case 'buy': socket.emit('buy', { item: t.dataset.item }, (r) => { ack(r); if (r && r.ok) Sound.play('coins', 2); }); break;
    case 'drink': socket.emit('drink', null, (r) => { ack(r); if (r && r.ok) Sound.play('heal'); }); break;
    case 'lens': socket.emit('lens', { door: i }); break;
    case 'dmGold': ui.dm[i].gold = Math.max(cfg().MIN_DOOR_GOLD, ui.dm[i].gold + Number(v)); sendDraft(); render(); break;
    case 'dmTier': ui.dm[i].tier = v; sendDraft(); render(); break;
    case 'dmEl': ui.dm[i].element = v; sendDraft(); render(); break;
    case 'dmSubmit': socket.emit('dmSubmit', draftForServer(), (r) => { ack(r); if (r && r.ok) Sound.play('lockIn'); }); break;
    case 'pickDoor': ui.adv.door = i; ui.adv.resting = false; render(); break;
    case 'approach': ui.adv.approach = v; render(); break;
    case 'tog': ui.adv[v] = !ui.adv[v]; render(); break;
    case 'lockIn': {
      const a = ui.adv;
      socket.emit('action', { type: 'door', door: a.door, approach: a.approach, armour: a.armour, lock: a.lock, charm: a.charm || null, shove: a.shove || null }, (r) => { ack(r); if (r && r.ok) Sound.play('lockIn'); });
      break;
    }
    case 'rest': ui.adv.door = null; ui.adv.resting = true; socket.emit('action', { type: 'rest' }, (r) => { ack(r); if (r && r.ok) Sound.play('lockIn'); }); render(); break;
    case 'haunt': socket.emit('haunt', { target: t.dataset.id || null }); Sound.play('ghost'); break;
    case 'sound': Sound.setMuted(!Sound.isMuted()); if (!Sound.isMuted()) { Sound.unlock(); Sound.play('click'); } render(); break;
    case 'log': downloadLog(v); break;
    case 'skip': Scene.skip(); break;
    case 'replay': Scene.replay(); break;
    case 'continue': socket.emit('continue'); break;
    case 'toLobby': socket.emit('toLobby'); break;
  }
});

render();
