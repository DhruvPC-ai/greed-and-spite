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
const guideRead = () => store.get('gs_guide') === '1';
let screen = null;
const ui = {
  name: store.get('gs_name') || '', code: '', dmKey: null, dm: null, advKey: null, adv: null, rules: false,
  tool: null, dmEl: 'fire',
  whisperTo: null, whisperPick: null, whispers: [], sayUntil: 0, merchantNext: 0,
};

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
    socket.emit('join', { code, name: ui.name, token, guide: guideRead() }, (r) => {
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
  if (S.phase === 'lobby' && !store.get('gs_tut_seen') && !Tutorial.isOpen()) openTutorial(0);
  const sk = D() ? `${S.phase}:${S.match.dIndex}:${D().round}:${D().role}` : S.phase;
  if (sk !== ui.sheetKey) {
    ui.sheetKey = sk;
    ui.sheet = defaultTab();
    ui.near = null;
    ui.readySent = false;
    ui.readyAt = S.phase === 'dungeonEnd' ? Date.now() + SCORES_MS : null;
    ui.revealGuard = S.phase === 'results' ? Date.now() + 30000 : 0;
    if (S.phase !== 'adv') { ScanView.close(); Room.setMyScan(false); }
  }
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
/* ---------- the room: movement, nearby things, talking ---------- */
// which view is on screen: the top-down room, or the side-view door hall
function viewMode() {
  const d = D();
  // the side-view hall is only for the reveal and the scores; everything else happens in the room
  if (!d || ['results', 'dungeonEnd', 'matchEnd'].includes(S.phase)) return 'hall';
  return 'room';
}
socket.on('pos', ({ id, x, y, d: dir }) => {
  const d = D();
  if (!d || !d.pos || id === S.me) return;
  d.pos[id] = { x, y, d: dir };
  Room.setPos(id, d.pos[id]);
  const a = d.advs.find((q) => q.id === id);
  Scene.setPos(id, x, y, a ? a.alive : true);
});
socket.on('emote', ({ id, text }) => { Room.say(id, text); Scene.say(id, text); Sound.play('pop'); });
socket.on('whisper', ({ from, text }) => {
  Room.say(from, text, 'whisper');
  ui.whispers.unshift({ from, to: S.me, text });
  Sound.play('whisper');
  if (ui.sheet === 'whisper') renderSheetOnly();
  else toast(`${pname(from)} whispered to you. Open Say to read it.`);
});
socket.on('huddle', ({ a, b }) => {
  if (a === S.me || b === S.me) return;
  Room.say(a, '…', 'huddle');
  Room.say(b, '…', 'huddle');
});
Room.onSend((p) => {
  const d = D();
  if (!d) return;
  d.pos[S.me] = p;
  socket.emit('move', p);
});
Room.onDoorTap((i) => { ui.dmSel = i; Sound.play('click'); render(); });
Room.onNear((n) => {
  if (n && n.type === 'door' && S && S.phase === 'adv' && ui.page !== n.i) { ui.page = n.i; if (ui.sheet === 'journal') renderPanel(); }
  ui.near = n;
  if (viewMode() === 'room') renderHudOnly();
  if (ui.sheet === 'whisper') renderSheetOnly();
});
Room.onAction(() => roomAction());
function roomAction() {
  const n = ui.near;
  if (!n) return;
  if (n.type === 'shop') { openSheet('shop'); merchantTalk(); }
  else if (n.type === 'door') { if (scanState(n.i).ok) startScan(n.i); else chooseDoor(n.i); }
  else if (n.type === 'fire') restNow();
  else if (n.type === 'person') { ui.whisperTo = n.id; ui.whisperPick = null; openSheet('talk'); }
}
function chooseDoor(i) {
  ui.adv.door = i;
  ui.adv.resting = false;
  sendPlanDraft();
  ui.page = 'plan';
  openSheet('journal');
}
// can I scan this door right now? and what should the button say?
function scanState(i) {
  const d = D();
  if (!d || d.role !== 'adv' || S.phase !== 'adv') return { ok: false, label: '' };
  const mine = d.mine;
  const R = ROMAN[i];
  const lensOn = ui.useLens && mine.inv.lens > 0;
  const k = mine.known[i];
  if (mine.scanning) return { ok: false, label: 'Scanning…' };
  if (k && !(lensOn && !k.lens)) return { ok: false, label: `Door ${R} scanned` };
  if (mine.flasks < 1) return { ok: false, label: 'Out of oil' };
  const left = S.deadline ? S.deadline - (Date.now() + clockOffset) : 1e9;
  if (left < cfg().SCAN_MS + 400) return { ok: false, label: 'No time to scan' };
  return { ok: true, label: lensOn ? `Scan Door ${R} with Lens` : `Scan Door ${R}`, lens: lensOn };
}
function startScan(i) {
  const st = scanState(i);
  if (!st.ok) return toast(st.label);
  Room.flushPos();
  socket.emit('scanStart', { door: i, lens: !!st.lens }, (r) => {
    if (!r || r.error) return toast((r && r.error) || 'Could not scan.');
    ScanView.show(i, r.ms, !!st.lens);
    Room.setMyScan(true);
    Sound.play('scan', r.ms / 1000);
    if (st.lens) ui.useLens = false;
  });
}
socket.on('scan', ({ id, door, on }) => { Room.setScan(id, door, on); });
socket.on('scanResult', (res) => {
  Room.setMyScan(false);
  if (res.cancelled) ScanView.cancel(res.reason);
  else ScanView.reveal(res);
});
Room.onCancelScan(() => socket.emit('scanCancel', { reason: 'moved' }));
// a whisper that names a door gets filed on that door's journal page
function doorIn(text) {
  const m = String(text).match(/\bDoor (IV|III|II|I)\b/);
  return m ? ROMAN.indexOf(m[1]) : -1;
}

function restNow() {
  ui.adv.door = null;
  ui.adv.resting = true;
  socket.emit('action', { type: 'rest' }, (r) => {
    ack(r);
    if (r && r.ok) { Sound.play('lockIn'); toast('You’ll rest by the fire this round. You can change your mind until time runs out.'); }
  });
  render();
}
// the plan as it stands counts if time runs out before you lock in
function sendPlanDraft() {
  const a = ui.adv;
  if (!a || a.door === null || !S || S.phase !== 'adv') return;
  socket.emit('actionDraft', { type: 'door', door: a.door, approach: a.approach, armour: a.armour, lock: a.lock, charm: a.charm || null, shove: a.shove || null });
}
function merchantTalk() {
  const lines = (S && cfg().MESSAGES.merchant) || [];
  if (!lines.length) return;
  const line = lines[Math.floor(Math.random() * lines.length)];
  if (viewMode() === 'room') Room.say('merchant', line); else Scene.say('merchant', line);
  ui.merchantNext = Date.now() + 9000 + Math.random() * 8000;
}
setInterval(() => {
  if (!S || !D() || !['setup', 'dm', 'adv'].includes(S.phase)) return;
  if (!ui.merchantNext) ui.merchantNext = Date.now() + 4000;
  if (Date.now() > ui.merchantNext) merchantTalk();
}, 1000);

/* ---------- settings: animations and fullscreen ---------- */
function animOff() {
  const pref = store.get('gs_anim');
  if (pref === 'on') return false;
  if (pref === 'off') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
window.GSAnimOff = animOff;
function applyAnim() { document.documentElement.classList.toggle('anim-off', animOff()); }
applyAnim();
const canFullscreen = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const inFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const isIPhone = () => /iPhone|iPod/.test(navigator.userAgent);
const installedApp = () => window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
function toggleFullscreen() {
  const el = document.documentElement;
  try {
    if (inFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const r = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      if (r && r.catch) r.catch(() => toast('This browser won’t go full screen.'));
    }
  } catch (e) { toast('This browser won’t go full screen.'); }
}
document.addEventListener('fullscreenchange', () => { if (ui.sheet === 'menu') renderSheetOnly(); setTimeout(() => Room.fit(), 100); });

socket.on('kicked', () => { store.del('gs_code'); S = null; render(); toast('The host removed you from the game.'); });
socket.on('disconnect', () => toast('Connection lost. Reconnecting…'));

function openTutorial(start) {
  store.set('gs_tut_seen', '1');
  Tutorial.show(start, () => {
    store.set('gs_guide', '1');
    if (S) socket.emit('guideDone');
  });
}
// which slide helps most with what's on screen right now
function helpSlide() {
  const d = D();
  if (!d) return 'welcome';
  if (S.phase === 'setup') return d.role === 'dm' ? 'dm' : 'elements';
  if (S.phase === 'dm') return d.role === 'dm' ? 'dm' : 'shop';
  if (S.phase === 'adv') return d.role === 'dm' ? 'dm' : d.role === 'ghost' ? 'ghosts' : 'doors';
  if (S.phase === 'results') return 'first';
  return 'welcome';
}

/* ---------- local drafts follow the server's round ---------- */
function syncLocal() {
  const d = D();
  if (!d) return;
  const key = `${S.match.dIndex}-${d.round}`;
  if (d.role === 'dm' && S.phase === 'dm' && ui.dmKey !== key) {
    ui.dmKey = key;
    ui.dm = Array.from({ length: d.doorsCount }, () => ({ gold: 0, tier: 'none', element: 'fire', illusion: 'honest' }));
    ui.dmSel = 0;
    evenGold();
    sendDraft();
  }
  if (ui.advKey !== key) {
    ui.advKey = key;
    ui.adv = { door: null, resting: false, approach: 'walk', armour: false, charm: '', lock: false, shove: '' };
    ui.marks = {};
    ui.useLens = false;
    ui.whisperTo = null;
    ui.whisperPick = null;
    ui.whispers = [];
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
const goldLeft = () => D().budget - ui.dm.reduce((s, x) => s + x.gold, 0);
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
  document.body.classList.toggle('in-game', want === 'game');
  if (want === 'home') { $app.innerHTML = renderHome(); screen = 'home'; }
  else if (want === 'lobby') { $app.innerHTML = renderLobby(); screen = 'lobby'; }
  else {
    if (screen !== 'game') {
      $app.innerHTML = `
        <header class="bar" id="bar"></header>
        <div class="layout">
          <aside class="col-left" id="left"></aside>
          <main class="col-mid">
            <div class="stage-title" id="stage-title"></div>
            <div class="stage" id="stage"><div id="scene-slot"></div><div id="room-slot"></div></div>
            <div id="hud"></div>
          </main>
          <section class="col-panel" id="panel"></section>
          <nav class="col-rail" id="rail" aria-label="Screens"></nav>
        </div>
        <div class="rotate" id="rotate"></div>`;
      screen = 'game';
      Scene.mount(document.getElementById('scene-slot'));
      Room.mount(document.getElementById('room-slot'));
    }
    if (!tabsFor().includes(ui.sheet)) ui.sheet = defaultTab();
    const inRoom = viewMode() === 'room';
    document.getElementById('bar').innerHTML = renderBar();
    document.documentElement.style.setProperty('--bar-h', document.getElementById('bar').offsetHeight + 'px');
    document.getElementById('scene-slot').hidden = inRoom;
    document.getElementById('room-slot').hidden = !inRoom;
    document.querySelector('.layout').classList.toggle('room-mode', inRoom);
    document.getElementById('stage-title').innerHTML = renderTitle();
    document.getElementById('hud').innerHTML = renderHud();
    document.getElementById('left').innerHTML = renderLeft();
    document.getElementById('rail').innerHTML = renderRail();
    renderPanel();
    document.getElementById('rotate').innerHTML = renderRotate();
    Room.setActive(inRoom);
    if (inRoom) { Room.update(S, ui); Room.fit(); } else Scene.update(S, ui);
  }
  $modal.innerHTML = ui.confirmLeave ? renderLeaveConfirm() : ui.rules ? renderRules() : Tutorial.isOpen() ? Tutorial.html() : '';
}
function renderHudOnly() {
  const h = document.getElementById('hud');
  if (h) h.innerHTML = renderHud();
}
function renderPanel() {
  const el = document.getElementById('panel');
  if (!el || !S || !S.match) return;
  const keep = el.scrollTop;
  el.innerHTML = renderTab();
  el.scrollTop = keep;
  const rail = document.getElementById('rail');
  if (rail) rail.innerHTML = renderRail();
}
const renderSheetOnly = () => renderPanel();
function openSheet(name) {
  ui.sheet = name;
  render();
  Sound.play('click');
}
// once the reveal finishes, a short reading pause starts; then everyone is "ready" on their own
const READ_MS = 10000, SCORES_MS = 25000;
Scene.onChange(() => {
  if (!S) return;
  if (S.phase === 'results' && !Scene.isPlaying() && !ui.readyAt) ui.readyAt = Date.now() + READ_MS;
  renderPanel();
  const l = document.getElementById('left');
  if (l) l.innerHTML = renderLeft();
});
function sendReady() {
  if (ui.readySent) return;
  ui.readySent = true;
  socket.emit('ready');
  renderPanel();
}
setInterval(() => {
  if (!S || !['results', 'dungeonEnd'].includes(S.phase)) return;
  if (!ui.readyAt && ui.revealGuard && Date.now() > ui.revealGuard) ui.readyAt = Date.now() + READ_MS;
  if (!ui.readyAt) return;
  const left = Math.max(0, Math.ceil((ui.readyAt - Date.now()) / 1000));
  const el = document.getElementById('ready-count');
  if (el) el.textContent = left;
  if (left <= 0) sendReady();
}, 250);
function renderRotate() {
  const full = canFullscreen() && !installedApp()
    ? '<button class="pbtn gold" data-act="fullscreen">Play full screen</button>'
    : isIPhone() && !installedApp() ? '<p class="small">For full screen on iPhone: tap Share, then <b>Add to Home Screen</b>, and open the game from there.</p>' : '';
  return `<div class="rotate-box">
    <div class="rotate-phone" aria-hidden="true"></div>
    <h2>Turn your phone sideways</h2>
    <p>The dungeon needs the whole screen. Hold your phone in landscape to play.</p>
    ${full}
  </div>`;
}

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
    <button class="pbtn sm" data-act="tut">How to play (1 minute)</button>
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
      <span class="tag ${p.guide ? 'ready' : ''}">${p.guide ? 'Read the guide' : 'Hasn’t read the guide'}</span>
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
      <button class="pbtn sm ${guideRead() ? 'quiet' : 'gold'}" data-act="tut">How to play (1 minute)</button>
      <button class="pbtn quiet sm" data-act="rules">Full rules</button>
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
`;
}

function renderTitle() {
  const d = D();
  const help = S.phase === 'matchEnd' || S.phase === 'dungeonEnd' ? '' : `<button class="pbtn sm quiet help-btn" data-act="tutHelp">Help</button>`;
  const t = (h, p) => `<h2>${h}</h2>${p ? `<p>${p}</p>` : ''}${help}`;
  if (S.phase === 'matchEnd') return t('The hoard is counted', '');
  if (S.phase === 'dungeonEnd') return t(`${esc(pname(d.dmId))}’s dungeon is done`, '');
  if (S.phase === 'setup') return t(d.role === 'dm' ? 'You are the dungeon master' : 'Gear up', d.role === 'dm' ? 'The adventurers are getting ready.' : 'Pick your element. The shopkeeper at the counter sells items.');
  if (S.phase === 'dm') return t(d.role === 'dm' ? 'Set your traps' : `${esc(pname(d.dmId))} is setting traps`, d.role === 'dm' ? 'The doors above preview what adventurers will see.' : 'The doors are sealed. Walk around, shop, and whisper while you wait.');
  if (S.phase === 'adv') {
    if (d.role === 'dm') return t('The adventurers are choosing', 'Watch them. Your traps show on the doors.');
    if (d.role === 'ghost') return t('You are a ghost', 'You see every real trap. Haunt someone, or whisper lies.');
    return t('Choose a door', 'Walk up to a door to scan it or choose it. Your journal keeps what you learn.');
  }
  if (S.phase === 'results') return t(`Round ${d.round}: the doors open`, '');
  return '';
}

/* ---------- side ---------- */
function partyRows() {
  const d = D();
  const hiding = S.phase === 'results' && d.lastResult && Scene.isPlaying();
  const view = d.advs.map((a) => {
    if (!hiding) return a;
    const b = d.lastResult.before[a.id];
    return { ...a, hp: b.hp, gold: b.gold, alive: b.hp > 0 };
  });
  const rows = view.filter((a) => !a.left).map((a) => {
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
  return rows;
}
function renderLeft() {
  const d = D();
  if (!d) return '';
  const m = S.match;
  const order = [...m.dmOrder].sort((a, b) => m.totals[b] - m.totals[a]);
  const totals = m.history.length ? `<div class="win scores-win"><div class="win-title">Match scores</div><table class="scores"><tbody>${order.map((id) => `<tr class="${id === S.me ? 'me' : ''}"><td>${esc(pname(id))}${(S.players.find((p) => p.id === id) || {}).left ? ' <span class="tag">Left</span>' : ''}</td><td class="num">${m.totals[id].toFixed(1)}</td></tr>`).join('')}</tbody></table></div>` : '';
  if (S.phase === 'matchEnd') return totals;
  return `
    <div class="win party-win">
      <div class="win-title">Party</div>
      <p class="small dmline"><span class="tag host">DM</span> ${esc(pname(d.dmId))}</p>
      <ul class="party">${partyRows()}</ul>
      <div class="wheel-mini" title="Each element beats the next one">
        ${['water', 'fire', 'air', 'earth', 'water'].map((e) => `<span class="el-${e}">${Sprites.icon(e, 2)}<i>${cap(e)}</i></span>`).join('<span class="sep">›</span>')}
      </div>
    </div>
    ${totals}`;
}

function steps(list) {
  const firstOpen = list.findIndex((x) => !x.done);
  return `<div class="steps">${list.map((x, k) => `<span class="step ${x.done ? 'done' : k === firstOpen ? 'now' : ''}"><b>${k + 1}</b>${x.text}</span>`).join('')}</div>`;
}
const SHORT = { fire: 'Smoke', water: 'Dripping', earth: 'Rumbling', air: 'Draft', none: 'Silent' };
const elementTag = (clue, aff) => (!aff || clue === 'none' ? '' : clue === aff ? ' <b class="rd-warn resist">Resist</b>' : cfg().WEAK_TO[aff] === clue ? ' <b class="rd-warn weak">Weak</b>' : '');
const elementWarning = (clue, aff) => {
  if (!aff || clue === 'none') return '';
  if (clue === aff) return `<span class="sd-warn resist" style="position:static;transform:none">Resist</span> You resist ${cap(clue)}: half damage.`;
  if (cfg().WEAK_TO[aff] === clue) return `<span class="sd-warn weak" style="position:static;transform:none">Weak</span> ${cap(clue)} beats ${cap(aff)}: ×1.5 damage to you.`;
  return '';
};

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
    const owned = k === 'potion' ? mine.potions : k === 'oil' ? `${mine.flasks} of ${mine.flaskCap}` : mine.inv[k];
    return `<div class="item">
      <div class="top"><span>${it.name}</span><span class="gold">${Sprites.icon('coin', 2)} ${it.cost}</span></div>
      <p>${it.text}</p>
      <div class="row">
        <button class="pbtn sm" data-act="buy" data-item="${k}" ${me.gold < it.cost || (k === 'oil' && mine.flasks >= mine.flaskCap) ? 'disabled' : ''}>Buy</button>
        <span class="muted small">You have ${owned}</span>
        ${k === 'potion' && mine.potions > 0 ? `<button class="pbtn sm" data-act="drink" ${me.hp >= c.START_HP ? 'disabled' : ''}>Drink</button>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<div class="shop-win"><div class="keeper-row"><span class="portrait">${Sprites.merchant(3)}</span><p class="small" style="margin:0">You have <span class="gold">${me.gold}</span> gold and ${me.hp} HP. Every item is single use. Gold you spend goes to the DM and no longer counts toward your score.</p></div><div class="items">${items}</div></div>`;
}

/* ----- action bar under the room ----- */
function renderHud() {
  const d = D();
  if (!d) return '';
  const role = d.role;
  if (viewMode() !== 'room') return '';
  const btns = [];
  if (role === 'adv' || role === 'ghost') {
    const n = ui.near;
    if (n && n.type === 'door' && role === 'adv' && S.phase === 'adv') {
      const st = scanState(n.i);
      btns.push(`<button class="pbtn gold act-btn" data-act="scanDoor" data-i="${n.i}" ${st.ok ? '' : 'disabled'}>${Sprites.icon('flask', 2)} ${st.label}</button>`);
      btns.push(`<button class="pbtn" data-act="chooseDoor" data-i="${n.i}">Choose Door ${ROMAN[n.i]}</button>`);
    } else {
      let label = role === 'ghost' ? 'Float up to someone' : 'Walk up to something';
      if (n) label = n.type === 'shop' ? 'Shop' : n.type === 'fire' ? 'Rest by the fire' : n.type === 'door' ? `Door ${ROMAN[n.i]}` : `Whisper to ${esc(pname(n.id))}`;
      btns.push(`<button class="pbtn gold act-btn" data-act="roomAct" ${n && n.type !== 'door' ? '' : 'disabled'}>${label}</button>`);
    }
    if (role === 'adv' && d.mine) {
      btns.push(`<span class="oil-chip" title="Oil for your lantern: one flask per scan">${Sprites.icon('flask', 2)} ${d.mine.flasks}/${d.mine.flaskCap}</span>`);
      if (S.phase === 'adv' && d.mine.inv.lens > 0) btns.push(`<button class="pbtn ${ui.useLens ? 'on' : ''}" data-act="lensToggle" aria-pressed="${!!ui.useLens}">${Sprites.icon('eye', 2)} Lens ${ui.useLens ? 'on' : 'off'}</button>`);
    }
  }
  const touch = window.matchMedia('(pointer: coarse)').matches;
  let hint;
  if (role === 'dm') hint = S.phase === 'dm' ? 'Tap a door to select it, then use the Traps screen on the right.' : 'You’re watching the room. Your traps show on the floor.';
  else hint = touch ? 'Tap where to go. Tap someone to walk up to them.' : 'Arrow keys or WASD to walk, E to use, or click where to go.';
  return `${btns.length ? `<div class="hud">${btns.join('')}</div>` : ''}<p class="hud-hint">${hint}</p>`;
}

/* ----- the sidebar of screens ----- */
const TABS = {
  gear: { label: 'Gear up', icon: () => Sprites.icon('amulet', 3) },
  journal: { label: 'Journal', icon: () => Sprites.icon('book', 3) },
  shop: { label: 'Shop', icon: () => Sprites.icon('bag', 3) },
  talk: { label: 'Talk', icon: () => Sprites.icon('bubble', 3) },
  history: { label: 'History', icon: () => Sprites.icon('scroll', 3) },
  menu: { label: 'Menu', icon: () => Sprites.icon('gear', 3) },
  haunt: { label: 'Haunt', icon: () => Sprites.ghost(4, 2).split('</svg>')[0] + '</svg>' },
  traps: { label: 'Traps', icon: () => Sprites.icon('spikes', 3) },
  story: { label: 'This round', icon: () => Sprites.icon('eye', 3) },
  scores: { label: 'Scores', icon: () => Sprites.icon('crown', 3) },
};
function tabsFor() {
  const d = D();
  if (!d) return ['menu'];
  const role = d.role, ph = S.phase;
  if (ph === 'matchEnd') return ['scores', 'menu'];
  if (ph === 'dungeonEnd') return ['scores', 'history', 'talk', 'menu'];
  if (ph === 'results') return ['story', 'history', 'talk', 'menu'];
  if (role === 'dm') return ['traps', 'talk', 'history', 'menu'];
  if (role === 'ghost') return (ph === 'adv' ? ['haunt'] : []).concat(['talk', 'history', 'menu']);
  return (ph === 'setup' ? ['gear'] : []).concat(['journal', 'shop', 'talk', 'history', 'menu']);
}
function defaultTab() {
  const d = D();
  if (!d) return 'menu';
  const ph = S.phase, role = d.role;
  if (ph === 'matchEnd' || ph === 'dungeonEnd') return 'scores';
  if (ph === 'results') return 'story';
  if (role === 'dm') return 'traps';
  if (role === 'ghost') return ph === 'adv' ? 'haunt' : 'talk';
  if (ph === 'setup') return d.mine && d.mine.setupReady ? 'journal' : 'gear';
  return 'journal';
}
function tabNeedsYou(t) {
  const d = D();
  if (!d) return false;
  if (t === 'gear') return d.mine && !d.mine.setupReady;
  if (t === 'journal') return S.phase === 'adv' && d.mine && !d.mine.action;
  if (t === 'haunt') return S.phase === 'adv' && !d.ghostDone;
  if (t === 'traps') return S.phase === 'dm';
  if (t === 'story' || t === 'scores') return ['results', 'dungeonEnd'].includes(S.phase) && !ui.readySent;
  return false;
}
function renderRail() {
  return tabsFor().map((t) => `<button class="rail-btn ${ui.sheet === t ? 'on' : ''}" data-act="sheet" data-v="${t}" aria-pressed="${ui.sheet === t}" title="${TABS[t].label}">
      <span class="rail-icon">${TABS[t].icon()}</span><span class="rail-label">${TABS[t].label}</span>${tabNeedsYou(t) ? '<span class="dot" aria-label="needs you"></span>' : ''}
    </button>`).join('');
}
function renderTab() {
  const d = D();
  const t = ui.sheet;
  let body = '';
  if (t === 'menu') body = renderMenu();
  else if (!d) body = '';
  else if (t === 'gear') body = renderSetup();
  else if (t === 'journal') body = renderBook();
  else if (t === 'shop') body = d.role === 'adv' && ['setup', 'dm', 'adv'].includes(S.phase) ? renderShop() : '<p class="muted">The shop is closed right now.</p>';
  else if (t === 'talk') body = renderTalk();
  else if (t === 'history') body = renderHistoryTab();
  else if (t === 'haunt') body = renderGhost();
  else if (t === 'traps') body = S.phase === 'dm' ? renderWorkshop() : S.phase === 'adv' ? renderDmSummary() : renderSetup();
  else if (t === 'story') body = renderStory();
  else if (t === 'scores') body = S.phase === 'matchEnd' ? renderMatchEnd() + `<div class="win"><div class="win-title">Score by dungeon</div>${renderHistory()}</div>` : renderScoresTab();
  return `<div class="panel-inner"><h3 class="panel-head">${TABS[t] ? TABS[t].label : ''}</h3>${body}</div>`;
}
function readyBox(nextLabel) {
  const need = S.players.filter((p) => p.connected && !p.left).length;
  const readyN = (S.ready || []).length;
  if (ui.readySent) return `<div class="readybox"><span class="muted">Waiting for the others… ${readyN} of ${need} ready.</span></div>`;
  if (!ui.readyAt) return '';
  const left = Math.max(0, Math.ceil((ui.readyAt - Date.now()) / 1000));
  return `<div class="readybox"><button class="pbtn gold" data-act="ready">Ready</button><span>${nextLabel} in <b id="ready-count">${left}</b>s${readyN ? ` (${readyN} of ${need} ready)` : ''}</span></div>`;
}
function storyHtml(r) {
  const lines = [];
  if (r.dmTimedOut) lines.push('<p class="muted">The DM ran out of time, so the dungeon set itself up.</p>');
  r.doors.forEach((x) => lines.push(`<p><span class="dn">${ROMAN[x.index]}</span>${esc(x.lines.join(' '))}</p>`));
  r.rests.forEach((x) => lines.push(`<p>${esc(pname(x.id))} ${x.auto ? 'didn’t choose in time and rested' : 'rested by the fire'}${x.healed ? ` (+${x.healed} HP)` : ''}.</p>`));
  r.haunts.forEach((x) => lines.push(`<p class="ghostname">${esc(pname(x.ghost))} haunted ${esc(pname(x.target))}${x.stolen ? ` and stole ${x.stolen} gold.` : ', who took no trap damage.'}</p>`));
  r.deaths.forEach((x) => lines.push(`<p style="color:var(--blood)">${esc(pname(x.id))} died, dropped ${x.dropped} gold, and rose as a ghost.</p>`));
  return `<div class="log">${lines.join('')}</div>`;
}
function renderStory() {
  const d = D();
  const r = (d.stories || [])[d.stories.length - 1];
  const playing = Scene.isPlaying();
  const last = d.round >= d.rounds || d.advs.every((a) => !a.alive || a.left);
  return `<div class="row" style="margin-bottom:10px">${playing ? '<button class="pbtn" data-act="skip">Skip</button>' : '<button class="pbtn" data-act="replay">Replay</button>'}</div>
    ${playing ? '' : readyBox(last ? 'Scores' : 'Next round')}
    ${playing || !r ? '<p class="muted">The doors are opening…</p>' : storyHtml(r)}`;
}
function renderHistoryTab() {
  const d = D();
  const st = (d && d.stories ? d.stories : []).slice().reverse();
  if (!st.length) return '<p class="muted">Nothing has happened in this dungeon yet. Each round’s story will be kept here.</p>';
  return st.map((r) => `<div class="hist"><h4>Round ${r.round}</h4>${storyHtml(r)}</div>`).join('');
}
function renderScoresTab() {
  const last = S.match.dIndex + 1 >= S.match.total;
  return readyBox(last ? 'Final scores' : 'Next dungeon') + renderDungeonEnd();
}
function renderTalk() {
  const d = D();
  const roam = ['setup', 'dm', 'adv'].includes(S.phase) && (d.role === 'adv' || d.role === 'ghost');
  return renderSay() + (roam ? `<h4 class="j-sub">Whisper</h4>${renderWhisper()}` : '');
}

function renderSay() {
  const voice = myVoice();
  const list = (voice && cfg().MESSAGES[voice]) || [];
  const cooling = Date.now() < ui.sayUntil;
  const heard = ui.whispers.slice(0, 4).map((w) => `<p class="small" style="margin:6px 0 0"><span class="ghostname">${w.from === S.me ? `You whispered to ${esc(pname(w.to))}` : `${esc(pname(w.from))} whispered`}:</span> ${esc(w.text)}</p>`).join('');
  return `<p class="muted small" style="margin-top:0">Everyone sees it above your head.</p>
    <div class="says">${list.map((t, k) => `<button class="say-chip" data-act="say" data-i="${k}" ${cooling ? 'disabled' : ''}>${esc(t)}</button>`).join('')}</div>
    ${heard ? `<div class="huddle-box" style="margin-top:12px">${heard}</div>` : ''}`;
}
function renderWhisper() {
  const near = Room.nearPeople();
  const to = ui.whisperTo && near.includes(ui.whisperTo) ? ui.whisperTo : near[0];
  const huddle = cfg().MESSAGES.huddle || [];
  const heard = ui.whispers.slice(0, 4).map((w) => `<p class="small" style="margin:6px 0 0"><span class="ghostname">${w.from === S.me ? `You whispered to ${esc(pname(w.to))}` : `${esc(pname(w.from))} whispered`}:</span> ${esc(w.text)}</p>`).join('');
  if (!to) return `<p class="muted" style="margin:0">Walk right up to someone to whisper. Everyone sees you huddle, but only they read it.</p>${heard}`;
  const pick = ui.whisperPick !== null ? huddle[ui.whisperPick] : null;
  return `
    ${near.length > 1 ? `<div class="seg" style="margin-bottom:8px">${near.map((id) => `<button class="pbtn sm ${id === to ? 'on' : ''}" data-act="whisperTo" data-id="${id}">${esc(pname(id))}</button>`).join('')}</div>` : ''}
    <p class="small" style="margin:0 0 8px">Whisper to <b>${esc(pname(to))}</b>. Everyone sees you huddle; only they read it.</p>
    ${pick ? `<div class="note" style="margin:0 0 8px">${esc(pick.split('{door}').join('…'))} <span class="muted">Which door?</span>
      <div class="seg" style="margin-top:6px">${Array.from({ length: D().doorsCount }, (_, k) => `<button class="pbtn sm" data-act="whisperDoor" data-i="${k}">Door ${ROMAN[k]}</button>`).join('')}<button class="pbtn sm quiet" data-act="whisperCancel">Cancel</button></div></div>` : ''}
    <div class="says">${huddle.map((t, k) => `<button class="say-chip whisper" data-act="whisper" data-i="${k}" data-id="${to}">${esc(t.split('{door}').join('…'))}</button>`).join('')}</div>
    ${heard}`;
}
function renderMenu() {
  const device = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let full = '';
  if (installedApp()) full = '';
  else if (canFullscreen()) full = `<button class="pbtn" data-act="fullscreen">${inFullscreen() ? 'Leave full screen' : 'Full screen'}</button>`;
  else if (isIPhone()) full = `<p class="small muted" style="margin:0">For full screen on iPhone: tap Share, then <b>Add to Home Screen</b>, and open the game from there.</p>`;
  const inGame = !!(S && S.match);
  return `<div class="menu-list">
    <button class="pbtn" data-act="sound">Sound: ${Sound.isMuted() ? 'off' : 'on'}</button>
    <button class="pbtn" data-act="anim">Animations: ${animOff() ? 'off' : 'on'}</button>
    ${device && !animOff() ? '' : device ? '<p class="small muted" style="margin:0">Your device asks for less motion, so animations start off. You can turn them on here.</p>' : ''}
    ${full}
    <button class="pbtn" data-act="tut">How to play</button>
    <button class="pbtn" data-act="rules">Full rules</button>
    ${inGame ? '<button class="pbtn" data-act="leaveAsk" style="color:#ff9a8c">Leave match</button>' : ''}
  </div>`;
}
function renderLeaveConfirm() {
  const d = D();
  const amDm = d && d.dmId === S.me && !['dungeonEnd', 'matchEnd'].includes(S.phase);
  return `<div class="modal"><div class="win" role="alertdialog" aria-label="Leave the match?" style="max-width:440px">
    <h2 style="font-size:24px">Leave the match?</h2>
    <p style="margin-top:10px">You can’t rejoin this match. Your scores so far stay on the board, but you can’t win.${amDm ? ' You’re the DM right now, so this dungeon ends early and you get nothing for it.' : ''}</p>
    <div class="row" style="margin-top:14px"><button class="pbtn" data-act="leaveNo">Stay</button><button class="pbtn gold" data-act="leaveYes">Leave</button></div>
  </div></div>`;
}

/* ----- waiting room ----- */
const myVoice = () => { const d = D(); return !d ? null : d.role === 'dm' ? 'dm' : d.role === 'ghost' ? 'ghost' : d.role === 'adv' ? 'adventurer' : null; };
function nearbyIds() {
  const d = D();
  if (!d || !d.pos || !d.pos[S.me]) return [];
  const c = cfg();
  const me = d.pos[S.me];
  return d.advIds.filter((id) => id !== S.me && d.pos[id] && Math.hypot((me.x - d.pos[id].x) * c.FLOOR_W, (me.y - d.pos[id].y) * c.FLOOR_H) <= c.NEAR);
}
/* ----- the DM's trap workshop ----- */
const GOLD_STEP = 5;
function evenGold() {
  const d = D();
  const n = ui.dm.length;
  const base = Math.floor(d.budget / n / GOLD_STEP) * GOLD_STEP;
  ui.dm.forEach((x, i) => (x.gold = base));
  ui.dm[0].gold += d.budget - base * n;
}
function baitGold(sel) {
  const d = D();
  const min = cfg().MIN_DOOR_GOLD;
  ui.dm.forEach((x, i) => (x.gold = min));
  ui.dm[sel].gold = d.budget - min * (ui.dm.length - 1);
}
const trapCost = (x) => (x.tier === 'none' ? 0 : cfg().TRAPS[x.tier].cost) + (x.illusion === 'honest' ? 0 : cfg().ILLUSION_COST);
function renderWorkshop() {
  const d = D();
  const c = cfg();
  const cost = dmCost();
  const mana = d.dm.mana;
  const spare = mana - cost;
  const sel = Math.min(ui.dmSel || 0, ui.dm.length - 1);
  const x = ui.dm[sel];
  const others = cost - trapCost(x);
  const crystals = mana <= 40
    ? Array.from({ length: mana }, (_, k) => `<i class="${k < spare ? 'lit' : ''}"></i>`).join('')
    : `<span class="mana-fill"><b style="width:${Math.max(0, (spare / mana) * 100)}%"></b></span>`;
  const bar = ui.dm.map((g, i) => `${i ? `<span class="gb-handle" data-h="${i - 1}" role="slider" aria-label="Move gold between door ${ROMAN[i - 1]} and door ${ROMAN[i]}" tabindex="0"></span>` : ''}<button class="gb-seg ${i === sel ? 'sel' : ''}" style="flex:${g.gold}" data-act="dmSel" data-i="${i}">${ROMAN[i]}: <b>${g.gold}</b></button>`).join('');
  const showsNow = x.illusion !== 'honest' ? x.illusion : x.tier === 'none' ? 'none' : x.element;
  const living = d.advs.filter((a) => a.alive && !a.left);
  const hurts = (e) => living.filter((a) => c.WEAK_TO[a.affinity] === e).map((a) => esc(pname(a.id)));
  const tabs = EL.map((e) => `<button class="pbtn sm ${ui.dmEl === e ? 'on' : ''}" data-act="dmElTab" data-v="${e}" title="${hurts(e).length ? 'Hurts ' + hurts(e).join(', ') + ' more' : ''}">${Sprites.icon(e, 2)}${hurts(e).length ? '<span class="hurtdot"></span>' : ''}</button>`).join('');
  const cards = ['minor', 'major', 'deadly'].map((t) => {
    const tc = c.TRAPS[t];
    const afford = others + tc.cost + (x.illusion === 'honest' ? 0 : c.ILLUSION_COST) <= mana;
    const on = x.tier === t && x.element === ui.dmEl;
    return `<button class="tcard el-${ui.dmEl} ${on ? 'on' : ''}" data-act="dmCard" data-v="${t}" ${afford || on ? '' : 'disabled'}>
      <span class="tc-name">${tc.name}</span>${Sprites.icon(ui.dmEl, 3)}<span class="tc-dmg">${tc.dmg} dmg</span><span class="tc-cost">${Sprites.icon('mana', 1)} ${tc.cost}</span></button>`;
  }).join('');
  const fakeAfford = others + (x.tier === 'none' ? 0 : c.TRAPS[x.tier].cost) + c.ILLUSION_COST <= mana;
  const fakes = [['honest', 'Real clue'], ['none', 'Silent'], ['fire', 'Smoke'], ['water', 'Dripping'], ['earth', 'Rumbling'], ['air', 'Draft']]
    .map(([v, l]) => `<button class="pbtn sm ${x.illusion === v ? 'on' : ''}" data-act="dmFake" data-v="${v}" ${v === 'honest' || x.illusion === v || fakeAfford || x.illusion !== 'honest' ? '' : 'disabled'}>${v !== 'honest' && v !== 'none' ? Sprites.icon(v, 2) : ''}${l}</button>`).join('');
  const weakNote = living.length ? `<p class="small muted" style="margin:6px 0 0">Weak to it: ${EL.map((e) => hurts(e).length ? `<span class="el-${e}">${cap(e)}</span> ${hurts(e).join(', ')}` : '').filter(Boolean).join('; ') || 'nobody yet'}.</p>` : '';
  return `<div class="workshop">
    <div class="mana-row"><span class="crystals" aria-hidden="true">${crystals}</span><span><b>${spare}</b> of ${mana} mana left</span></div>
    <p class="mana-note">Mana is your trap budget. ${d.dm.nextIncome ? `+${d.dm.nextIncome} next round; whatever you don’t spend carries over.` : 'Last round: spend it.'}</p>
    <div class="ws-label">Gold: ${d.budget} to hide</div>
    <div class="goldbar" id="goldbar">${bar}</div>
    <p class="small muted" style="margin:4px 0 8px">Drag a line to move gold between doors. Every door keeps at least ${c.MIN_DOOR_GOLD}.</p>
    <div class="row"><button class="pbtn sm" data-act="dmEven">Even</button><button class="pbtn sm" data-act="dmBait">Bait: most on Door ${ROMAN[sel]}</button></div>
    <div class="ws-door">
      <div class="ws-label">Door ${ROMAN[sel]} <span class="muted">(tap a door to pick another)</span></div>
      <p class="small" style="margin:0">${x.gold} gold. Trap: <b>${x.tier === 'none' ? 'none' : `${c.TRAPS[x.tier].name} ${cap(x.element)}`}</b>. Shows: <b class="el-${showsNow}">${SHORT[showsNow]}</b>${x.illusion !== 'honest' ? ' <span class="ttag spite">fake</span>' : ''}</p>
    </div>
    <div class="ws-label">Your hand <span class="seg el-tabs-mini">${tabs}</span></div>
    <div class="tcards">${cards}</div>
    ${weakNote}
    <div class="ws-label">Fake clue <span class="muted">(${Sprites.icon('mana', 1)} ${c.ILLUSION_COST})</span></div>
    <div class="seg fakes">${fakes}</div>
    <div class="row" style="margin-top:10px"><button class="pbtn sm quiet" data-act="dmClear">Clear Door ${ROMAN[sel]}</button></div>
    <button class="pbtn gold lockin" data-act="dmSubmit">Lock in the dungeon</button>
    <p class="small muted" style="margin:6px 0 0">If time runs out, whatever you’ve built is used.</p>
  </div>`;
}
function renderDmSummary() {
  const d = D();
  const c = cfg();
  const waiting = d.advs.filter((a) => !a.ready && !a.left).map((a) => esc(pname(a.id)));
  const rows = (d.dm.doors || []).map((x, i) => `<tr><td><b>${ROMAN[i]}</b></td><td class="gold">${x.gold}</td><td>${x.trap ? `<span class="el-${x.trap.element}">${c.TRAPS[x.trap.tier].name} ${cap(x.trap.element)}</span>` : 'No trap'}</td><td>${x.illusion !== null ? `<span class="ttag spite">fake: ${SHORT[x.illusion]}</span>` : ''}</td></tr>`).join('');
  return `<p style="margin-top:0">${waiting.length ? `Still choosing: ${waiting.join(', ')}.` : 'Everyone has chosen.'}</p>
    <table class="scores"><thead><tr><th>Door</th><th>Gold</th><th>Trap</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small muted">Watch the room: lantern beams show who is scanning which door.</p>`;
}
function dmApply(fn) {
  const d = D();
  const x = ui.dm[Math.min(ui.dmSel || 0, ui.dm.length - 1)];
  const before = { ...x };
  fn(x);
  if (dmCost() > d.dm.mana) {
    Object.assign(x, before);
    Sound.play('empty');
    return toast('Not enough mana for that.');
  }
  sendDraft();
  render();
}
// dragging the lines in the gold bar
const goldDrag = { h: null };
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.gb-handle');
  if (!h || !S || S.phase !== 'dm' || !D() || D().role !== 'dm') return;
  e.preventDefault();
  goldDrag.h = Number(h.dataset.h);
  h.setPointerCapture && h.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', (e) => {
  if (goldDrag.h === null) return;
  const bar = document.getElementById('goldbar');
  if (!bar) return;
  const d = D();
  const min = cfg().MIN_DOOR_GOLD;
  const r = bar.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const h = goldDrag.h;
  const before = ui.dm.slice(0, h).reduce((s, x) => s + x.gold, 0);
  const pair = ui.dm[h].gold + ui.dm[h + 1].gold;
  let b = Math.round((frac * d.budget) / GOLD_STEP) * GOLD_STEP;
  b = Math.max(before + min, Math.min(before + pair - min, b));
  const g = b - before;
  if (g === ui.dm[h].gold) return;
  ui.dm[h].gold = g;
  ui.dm[h + 1].gold = pair - g;
  // update the bar live without rebuilding the screen
  bar.querySelectorAll('.gb-seg').forEach((seg, i) => { seg.style.flex = ui.dm[i].gold; seg.querySelector('b').textContent = ui.dm[i].gold; });
  Room.update(S, ui);
});
document.addEventListener('pointerup', () => {
  if (goldDrag.h === null) return;
  goldDrag.h = null;
  Sound.play('coins', 1);
  sendDraft();
  render();
});
// keyboard: arrow keys move a focused line by 5 gold
document.addEventListener('keydown', (e) => {
  const h = e.target.closest && e.target.closest('.gb-handle');
  if (!h || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  const i = Number(h.dataset.h);
  const min = cfg().MIN_DOOR_GOLD;
  const delta = e.key === 'ArrowRight' ? GOLD_STEP : -GOLD_STEP;
  if (ui.dm[i].gold + delta < min || ui.dm[i + 1].gold - delta < min) return;
  ui.dm[i].gold += delta;
  ui.dm[i + 1].gold -= delta;
  sendDraft();
  render();
  const again = document.querySelector(`.gb-handle[data-h="${i}"]`);
  if (again) again.focus();
});

function renderDmWatch() {
  const d = D();
  const waiting = d.advs.filter((a) => !a.ready).map((a) => esc(pname(a.id)));
  return `<div class="win"><p style="margin:0">${waiting.length ? `Still choosing: ${waiting.join(', ')}.` : 'Everyone has chosen.'} Your traps show on the doors. Only you and the ghosts can see them.</p></div>`;
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

  const act = mine.action;
  let locked = '';
  if (act) {
    if (act.type === 'rest') locked = 'Locked in: Rest.';
    else {
      const ex = [act.armour && 'Armour', act.lock && 'Lock', act.charm && `Charm (${cap(act.charm)})`, act.shove && `Shove ${pname(act.shove)}`].filter(Boolean);
      locked = `Locked in: ${VERB[act.approach]} through door ${ROMAN[act.door]}${ex.length ? ' with ' + ex.join(', ') : ''}.`;
    }
  }
  const warnLine = sel ? elementWarning(sel.clue, mine.affinity) : '';
  return `<div class="win">
      ${steps([
        { text: sel ? `Door ${ROMAN[a.door]}` : 'Pick a door', done: !!sel },
        { text: `${VERB[a.approach]}${sel ? '' : ' (pick how)'}`, done: !!sel && !!act },
        { text: act ? 'Locked in' : 'Lock in', done: !!act },
      ])}
      <div class="win-title">${sel ? `Door ${ROMAN[a.door]} <span class="muted"><span class="gold">${sel.gold} gold</span>. ${sel.clue ? `<span class="el-${sel.clue}">${CLUE[sel.clue]}</span>` : 'Not scanned.'}</span>` : 'Pick a door above'}</div>
      ${warnLine ? `<p class="small" style="margin:-4px 0 12px">${warnLine}</p>` : ''}
      <div class="seg">${approaches}</div>
      ${items.length ? `<div class="win-title" style="margin-top:14px">Items</div><div class="seg">${items.join('')}</div>` : ''}
      ${act ? `<div class="note">${esc(locked)} You can change it until time runs out.</div>` : ''}
      <div class="row" style="margin-top:14px">
        <button class="pbtn gold" data-act="lockIn" ${sel ? '' : 'disabled'}>${sel ? `${VERB[a.approach]} through door ${ROMAN[a.door]}` : 'Pick a door first'}</button>
        <button class="pbtn" data-act="rest">Rest by the fire<span class="sub">+${c.REST_HEAL} HP, no gold</span></button>
      </div>
      <p class="muted small" style="margin:12px 0 0">Only the first ones in spring the trap. A room needs ${c.ROOM_BAGS} bags to empty; with more, the gold is split by bags. If time runs out, the plan you’ve picked counts even if you didn’t lock it in. With no door picked, you rest.</p>
    </div>`;
}

/* ----- the journal as a book: overview strip, ribbons, one page at a time ----- */
function renderBook() {
  const d = D();
  const c = cfg();
  const mine = d.mine;
  if (S.phase !== 'adv') {
    return `<div class="book"><div class="book-page">
      <h4 class="book-title">Journal</h4>
      <p>The doors are sealed while the DM builds. When they open, walk up to one and scan it with your lantern; what you learn is written here.</p>
      <p>${Sprites.icon('flask', 2)} Oil: <b>${mine.flasks}</b> of ${mine.flaskCap}. You get ${mine.flasksPerRound} more each round.</p>
    </div></div>`;
  }
  const a = ui.adv;
  const marks = ui.marks || {};
  let page = ui.page === undefined || ui.page === null ? (a.door !== null ? a.door : 0) : ui.page;
  if (page !== 'plan' && (page < 0 || page >= d.doors.length)) page = 0;
  const strip = d.doors.map((x, i) => {
    const k = mine.known[i];
    const chosen = a.door === i && !a.resting;
    return `<button class="ov ${page === i ? 'on' : ''} ${chosen ? 'chosen' : ''}" data-act="page" data-v="${i}" aria-label="Door ${ROMAN[i]}">
      <b>${ROMAN[i]}</b><span class="gold">${x.gold}</span><span class="ov-clue">${k ? Sprites.icon(k.clue, 2) : '?'}</span>${marks[i] ? `<span class="ov-mark m-${marks[i]}"></span>` : ''}${chosen ? '<span class="ov-star">★</span>' : ''}</button>`;
  }).join('');
  const ribbons = d.doors.map((_, i) => `<button class="ribbon ${page === i ? 'on' : ''}" data-act="page" data-v="${i}">${ROMAN[i]}</button>`).join('')
    + `<button class="ribbon plan ${page === 'plan' ? 'on' : ''}" data-act="page" data-v="plan">Plan${mine.action ? '' : ' •'}</button>`;
  let body;
  if (page === 'plan') {
    body = `<h4 class="book-title">Your plan</h4>${renderAdventurer()}`;
  } else {
    const i = page, x = d.doors[i], k = mine.known[i];
    const chosen = a.door === i && !a.resting;
    const clue = k
      ? `${Sprites.icon(k.clue, 2)} Clue: <b class="el-${k.clue}">${SHORT[k.clue]}</b>${k.clue !== 'none' ? ` (${cap(k.clue)})` : ''}${elementTag(k.clue, mine.affinity)}`
      : `Not scanned yet. ${mine.flasks > 0 ? 'Walk up to it and scan it.' : 'Your lantern is out of oil.'}`;
    const lens = k && k.lens ? `<p>${Sprites.icon('eye', 2)} Lens: <b>${k.lens.trap ? `${c.TRAPS[k.lens.trap.tier].name} ${cap(k.lens.trap.element)} trap` : 'no trap'}</b>${k.lens.illusion ? ' <span class="ttag spite">the clue is fake</span>' : ''}</p>` : '';
    const rumours = ui.whispers.filter((w) => w.from !== S.me && doorIn(w.text) === i).slice(0, 3).map((w) => `<p class="j-rumour">${esc(pname(w.from))}: “${esc(w.text)}”</p>`).join('');
    const mk = Object.entries(MARK_NAMES).map(([m, label]) => `<button class="mark-btn m-${m} ${marks[i] === m ? 'on' : ''}" data-act="mark" data-i="${i}" data-v="${m}" aria-pressed="${marks[i] === m}">${label}</button>`).join('');
    body = `<h4 class="book-title">Door ${ROMAN[i]} <span class="gold">${Sprites.icon('coin', 2)} ${x.gold}</span></h4>
      <p>${clue}</p>${lens}
      ${rumours ? `<div class="rumours"><span class="muted small">Rumours</span>${rumours}</div>` : ''}
      <div class="j-actions">${mk}</div>
      <button class="pbtn ${chosen ? 'on' : 'gold'} choose-btn" data-act="pickDoor" data-i="${i}">${chosen ? `Door ${ROMAN[i]} is your choice` : `Choose Door ${ROMAN[i]}`}</button>`;
  }
  const nudge = !Object.keys(mine.known || {}).length && mine.flasks > 0 ? `<p class="book-nudge">You haven’t scanned a door yet. Walk up to one and ${window.matchMedia('(pointer: coarse)').matches ? 'tap' : 'press E for'} Scan.</p>` : '';
  return `<div class="book">
    <div class="ov-strip">${strip}</div>
    <div class="ribbons">${ribbons}</div>
    <div class="book-page">${nudge}${body}</div>
    <p class="small muted book-oil">${Sprites.icon('flask', 2)} Oil ${mine.flasks}/${mine.flaskCap}</p>
  </div>`;
}

/* ----- the journal: a page per door, your marks, rumours, and the plan ----- */
const MARK_NAMES = { safe: 'Safe?', trap: 'Trap?', liar: 'Liar?' };
function renderJournal() {
  const d = D();
  const c = cfg();
  const mine = d.mine;
  const a = ui.adv;
  const marks = ui.marks || {};
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const scannedAny = Object.keys(mine.known || {}).length > 0;
  const nudge = !scannedAny && mine.flasks > 0
    ? `<div class="note" style="margin-top:0">You haven’t scanned a door yet. Walk up to one and ${touch ? 'tap' : 'press E for'} <b>Scan</b>. It uses one oil flask, and only you see what it shows.</div>` : '';
  const oil = `<p class="small" style="margin:0 0 10px">${Sprites.icon('flask', 2)} Oil: <b>${mine.flasks}</b> of ${mine.flaskCap}. Each scan uses one flask, and you get ${mine.flasksPerRound} more each round.${mine.inv.lens ? ` You have ${mine.inv.lens === 1 ? 'a Lens' : mine.inv.lens + ' Lenses'}: turn it on before a scan to see the real trap.` : ''}</p>`;
  const pages = d.doors.map((x, i) => {
    const k = mine.known[i];
    const chosen = a.door === i && !a.resting;
    const clue = k
      ? `${Sprites.icon(k.clue, 2)} Clue: <b class="el-${k.clue}">${SHORT[k.clue]}</b>${k.clue !== 'none' ? ` <span class="muted">(${cap(k.clue)})</span>` : ''}${elementTag(k.clue, mine.affinity)}`
      : '<span class="muted">Not scanned</span>';
    const lens = k && k.lens
      ? `<div class="j-line">${Sprites.icon('eye', 2)} Lens: <b>${k.lens.trap ? `${c.TRAPS[k.lens.trap.tier].name} ${cap(k.lens.trap.element)} trap` : 'no trap'}</b>${k.lens.illusion ? ' <span class="ttag spite">the clue is fake</span>' : ''}</div>` : '';
    const rumours = ui.whispers.filter((w) => w.from !== S.me && doorIn(w.text) === i).slice(0, 3)
      .map((w) => `<div class="j-rumour">${esc(pname(w.from))}: “${esc(w.text)}”</div>`).join('');
    const mk = Object.entries(MARK_NAMES).map(([m, label]) => `<button class="mark-btn m-${m} ${marks[i] === m ? 'on' : ''}" data-act="mark" data-i="${i}" data-v="${m}" aria-pressed="${marks[i] === m}">${label}</button>`).join('');
    return `<div class="j-door ${chosen ? 'chosen' : ''}">
      <div class="j-head"><b>Door ${ROMAN[i]}</b><span class="gold">${Sprites.icon('coin', 2)} ${x.gold}</span>${marks[i] ? `<span class="mark-chip m-${marks[i]}">${MARK_NAMES[marks[i]]}</span>` : ''}</div>
      <div class="j-line">${clue}</div>${lens}${rumours}
      <div class="j-actions">${mk}<button class="pbtn sm ${chosen ? 'on' : ''}" data-act="pickDoor" data-i="${i}">${chosen ? 'Chosen' : 'Choose'}</button></div>
    </div>`;
  }).join('');
  return `${nudge}${oil}<div class="j-doors">${pages}</div><h4 class="j-sub">Your plan</h4>${renderAdventurer()}`;
}

/* ----- results ----- */
/* ----- dungeon end ----- */
function renderDungeonEnd() {
  const d = D();
  const sc = d.scores;
  const N = d.advIds.length;
  const rows = Object.entries(sc).sort((a, b) => b[1].score - a[1].score).map(([id, s]) => `
    <tr><td>${esc(pname(id))}</td>
    <td>${s.role === 'dm' ? 'DM' : s.alive ? 'Adventurer' : '<span class="ghostname">Ghost</span>'}${s.left ? ' <span class="tag">Left</span>' : ''}</td>
    <td class="num">${s.held}</td>
    <td class="num"><b>${s.score.toFixed(1)}</b></td></tr>`).join('');
  const lastD = S.match.dIndex + 1 >= S.match.total;
  return `${renderAwards(d)}<div class="win">
    ${d.endedEarly ? `<div class="note warn" style="margin-top:0">${d.endedEarly === 'dmLeft' ? 'The DM left, so this dungeon ended early. Scores count only the gold that was in play.' : 'Too few players are left, so this dungeon ended early.'}</div>` : ''}
    <div class="win-title">Dungeon scores <span class="muted">Pot ${d.P} gold</span></div>
    <div class="tablewrap"><table class="scores">
      <thead><tr><th>Player</th><th>Role</th><th class="num">Gold</th><th class="num">Score</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="muted small" style="margin-top:10px">Adventurer score = gold held × ${N} ÷ ${d.P} × 100. DM score = gold not held by adventurers ÷ ${d.P} × 100.</p>
    ${lastD ? '' : `<p class="small muted" style="margin:0">Next DM: <b>${esc(pname(S.match.dmOrder[S.match.dIndex + 1]))}</b></p>`}
  </div>
  <div class="win"><div class="win-title">Match log <span class="muted">Every round so far, for tuning the game</span></div>${logButtons()}</div>`;
}

const AWARD_ICON = { greediest: 'coin', canary: 'heart', spiteful: 'lock', daredevil: 'fire', coward: 'zz', untouchable: 'crown', trapmaster: 'skull', scout: 'eye' };
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
  const leftIds = S.players.filter((p) => p.left).map((p) => p.id);
  const stayers = sorted.filter((id) => !leftIds.includes(id));
  const topStay = stayers.length ? m.totals[stayers[0]] : top;
  const winners = stayers.filter((id) => m.totals[id] === topStay).map((id) => esc(pname(id)));
  const names = winners.length > 1 ? winners.slice(0, -1).join(', ') + ' and ' + winners[winners.length - 1] : winners[0];
  const place = (id) => 1 + stayers.filter((x) => m.totals[x] > m.totals[id]).length;
  return `<div class="win">
    <div class="winner">${names} ${winners.length > 1 ? 'share the hoard' : 'takes the hoard'}</div>
    <div class="tablewrap"><table class="scores">
      <thead><tr><th>Rank</th><th>Player</th><th class="num">Total</th></tr></thead>
      <tbody>${sorted.map((id) => `<tr><td>${leftIds.includes(id) ? '–' : place(id)}</td><td>${esc(pname(id))}${leftIds.includes(id) ? ' <span class="tag">Left</span>' : ''}</td><td class="num"><b>${m.totals[id].toFixed(1)}</b></td></tr>`).join('')}</tbody>
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
      <li>The DM hides gold behind the doors and buys traps with mana, their trap budget. On the Traps screen, the DM taps a door in the room, drags the gold bar to share out the gold, taps trap cards to place them, and can add a fake clue. The DM starts each dungeon with 8 mana banked, gets more every round, and keeps what they don’t spend. Every trap has an element.</li>
      <li>Adventurers see each door’s gold. Its clue is hidden: walk up to a door and scan it with your lantern (one oil flask, 3 seconds, and only you see the result). A trapped door’s clue is its real element; an empty door is silent. The DM can pay for an illusion to fake either, and illusions fool scans too.</li>
      <li>You get oil each round (one fewer flask than there are doors) and can carry as many flasks as there are doors. The shopkeeper sells more. A Lens makes your next scan show the real trap and its strength.</li>
      <li>Each adventurer secretly picks a door and how to go in, or rests by the fire (+10 HP). Then the doors open one at a time. After a short pause to read what happened (or once everyone presses Ready), the next round starts on its own. The History screen keeps every round’s story.</li>
    </ul>
    <h3>Going in</h3>
    <ul>
      <li>Sprint: 3 bags, ×1.5 damage if first in. Walk: 2 bags, ×1. Sneak: 1 bag, ×0.5.</li>
      <li>Only the fastest group into a room springs the trap. Anyone slower behind them is safe.</li>
      <li>A room needs 3 bags to empty. With more than 3 bags, gold splits by bags. With fewer, the rest stays with the DM.</li>
    </ul>
    <h3>Elements</h3>
    <p>Your element halves damage from that element and adds 50% from the one that beats it. Water beats Fire, Fire beats Air, Air beats Earth, Earth beats Water. Doors show a Weak or Resist badge for you, so you don’t need to remember this.</p>
    <h3>Items (single use; the shop is open while the DM sets traps and while you choose)</h3>
    <ul>
      <li>Potion: +40 HP. Armour: half damage this round. Charm: resist one element this round.</li>
      <li>Oil flask: one more scan. Lens: your next scan shows the real trap, even through an illusion.</li>
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
  if (e.scanned) return `${e.player} scanned door ${e.scanned}${e.lens ? ' with a Lens' : ''} and saw ${e.saw}`;
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
  else if (e.key === 'Escape' && ui.confirmLeave) { ui.confirmLeave = false; render(); }
  else if (e.key === 'Escape' && ui.sheet && !Tutorial.isOpen()) { ui.sheet = null; render(); }
  if (Tutorial.isOpen()) {
    if (e.key === 'Escape') { Tutorial.handle('tutClose'); render(); }
    if (e.key === 'ArrowRight') { Tutorial.handle('tutNext'); render(); }
    if (e.key === 'ArrowLeft') { Tutorial.handle('tutPrev'); render(); }
  }
  if (e.key === 'Enter' && e.target.dataset.input === 'code') doJoin();
});
function sendWhisper(to, i, door) {
  Room.flushPos();
  socket.emit('whisper', { to, i, door }, (r) => {
    if (!r || r.error) return toast((r && r.error) || 'Could not whisper.');
    Room.say(S.me, r.text, 'whisper');
    ui.whispers.unshift({ from: S.me, to, text: r.text });
    Sound.play('whisper');
    renderSheetOnly();
  });
}

function doJoin() {
  if (!ui.name.trim()) return toast('Enter your name first.');
  store.set('gs_name', ui.name.trim());
  socket.emit('join', { code: ui.code, name: ui.name.trim(), token, guide: guideRead() }, ack);
}
document.addEventListener('change', (e) => {
  const k = e.target.dataset.change;
  if (!k) return;
  const v = e.target.value;
  if (k === 'rounds') socket.emit('settings', { rounds: Number(v) });
  if (k === 'pace') socket.emit('settings', { pace: v });
  if (k === 'dmIll') { ui.dm[Number(e.target.dataset.i)].illusion = v; sendDraft(); render(); }
  if (k === 'charm') { ui.adv.charm = v; sendPlanDraft(); render(); }
  if (k === 'shove') { ui.adv.shove = v; sendPlanDraft(); render(); }
});
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if ((t.dataset.act === 'closeRules' || t.dataset.act === 'tutClose') && e.target.closest('[data-stop]') && !e.target.closest('button')) return;
  const act = t.dataset.act;
  const i = t.dataset.i !== undefined ? Number(t.dataset.i) : null;
  const v = t.dataset.v;
  switch (act) {
    case 'create':
      if (!ui.name.trim()) return toast('Enter your name first.');
      store.set('gs_name', ui.name.trim());
      socket.emit('create', { name: ui.name.trim(), token, guide: guideRead() }, ack);
      break;
    case 'join': doJoin(); break;
    case 'leave': socket.emit('leave'); store.del('gs_code'); S = null; render(); break;
    case 'kick': socket.emit('kick', { pid: t.dataset.id }); break;
    case 'start': socket.emit('start', null, ack); break;
    case 'rules': ui.rules = true; Tutorial.close(false); render(); break;
    case 'tut': openTutorial(0); render(); break;
    case 'tutHelp': openTutorial(helpSlide()); render(); break;
    case 'tutNext': case 'tutPrev': case 'tutGo': case 'tutClose': case 'tutDone':
      Tutorial.handle(act, i); render(); break;
    case 'closeRules': ui.rules = false; render(); break;
    case 'aff': socket.emit('affinity', { element: t.dataset.el }); break;
    case 'setupReady': socket.emit('setupReady'); Sound.play('lockIn'); break;
    case 'buy': socket.emit('buy', { item: t.dataset.item }, (r) => { ack(r); if (r && r.ok) Sound.play('coins', 2); }); break;
    case 'drink': socket.emit('drink', null, (r) => { ack(r); if (r && r.ok) Sound.play('heal'); }); break;

    case 'dmGold': {
      const delta = Number(v);
      if (delta > 0 && goldLeft() < delta) return toast('All the gold is already hidden.');
      ui.dm[i].gold = Math.max(cfg().MIN_DOOR_GOLD, ui.dm[i].gold + delta);
      Sound.play('coins', 1); sendDraft(); render(); break;
    }
    case 'dmElTab': ui.dmEl = v; render(); break;
    case 'dmSel': ui.dmSel = i; render(); break;
    case 'dmCard': dmApply((x) => { x.tier = v; x.element = ui.dmEl; }); Sound.play('place'); break;
    case 'dmFake': dmApply((x) => { x.illusion = v; }); Sound.play('illusion'); break;
    case 'dmClear': dmApply((x) => { x.tier = 'none'; x.illusion = 'honest'; }); Sound.play('shove'); break;
    case 'dmEven': evenGold(); Sound.play('coins', 3); sendDraft(); render(); break;
    case 'dmBait': baitGold(Math.min(ui.dmSel || 0, ui.dm.length - 1)); Sound.play('coins', 4); sendDraft(); render(); break;
    case 'ready': sendReady(); break;
    case 'page': ui.page = v === 'plan' ? 'plan' : Number(v); renderPanel(); Sound.play('click'); break;
    case 'say': {
      if (Date.now() < ui.sayUntil) break;
      ui.sayUntil = Date.now() + 2600;
      socket.emit('emote', { i });
      renderSheetOnly();
      setTimeout(renderSheetOnly, 2700);
      break;
    }
    case 'whisperTo': ui.whisperTo = t.dataset.id; renderSheetOnly(); break;
    case 'whisperCancel': ui.whisperPick = null; renderSheetOnly(); break;
    case 'whisper': {
      const text = cfg().MESSAGES.huddle[i] || '';
      if (text.includes('{door}')) { ui.whisperPick = i; ui.whisperTo = t.dataset.id; renderSheetOnly(); break; }
      sendWhisper(t.dataset.id, i, null);
      break;
    }
    case 'whisperDoor': sendWhisper(ui.whisperTo || Room.nearPeople()[0], ui.whisperPick, i); ui.whisperPick = null; break;
    case 'dmSubmit': socket.emit('dmSubmit', draftForServer(), (r) => { ack(r); if (r && r.ok) Sound.play('lockIn'); }); break;
    case 'pickDoor': ui.adv.door = i; ui.adv.resting = false; ui.page = 'plan'; sendPlanDraft(); render(); break;
    case 'approach': ui.adv.approach = v; sendPlanDraft(); render(); break;
    case 'tog': ui.adv[v] = !ui.adv[v]; sendPlanDraft(); render(); break;
    case 'sheet':
      if (v === 'shop' && !(ui.near && ui.near.type === 'shop')) {
        // the shop is a place: walk there
        Room.walkTo({ x: (64 - 26) / 332, y: (346 - 118) / 248 });
        toast('Walking to the shopkeeper…');
        break;
      }
      ui.sheet = v; render(); Sound.play('click'); break;
    case 'sheetClose': ui.sheet = null; render(); break;
    case 'roomAct': roomAction(); break;
    case 'scanDoor': startScan(i); break;
    case 'chooseDoor': chooseDoor(i); break;
    case 'scanStop': socket.emit('scanCancel'); break;
    case 'lensToggle': ui.useLens = !ui.useLens; renderHudOnly(); break;
    case 'mark': ui.marks[i] = ui.marks[i] === v ? null : v; render(); break;
    case 'anim': store.set('gs_anim', animOff() ? 'on' : 'off'); applyAnim(); render(); break;
    case 'fullscreen': toggleFullscreen(); break;
    case 'leaveAsk': ui.confirmLeave = true; render(); break;
    case 'leaveNo': ui.confirmLeave = false; render(); break;
    case 'leaveYes':
      ui.confirmLeave = false; ui.sheet = null;
      socket.emit('leave'); store.del('gs_code'); S = null; render();
      toast('You left the match.');
      break;
    case 'lockIn': {
      const a = ui.adv;
      socket.emit('action', { type: 'door', door: a.door, approach: a.approach, armour: a.armour, lock: a.lock, charm: a.charm || null, shove: a.shove || null }, (r) => { ack(r); if (r && r.ok) Sound.play('lockIn'); });
      break;
    }
    case 'rest': restNow(); break;
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
