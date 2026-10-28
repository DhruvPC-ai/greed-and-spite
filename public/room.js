'use strict';
/* The top-down room: everyone walks around, shops, rests by the fire and whispers.
   Measurements are in room pixels. The server uses the same floor size (332 × 248) for whisper distance. */
const Room = (() => {
  const RW = 384, RH = 384;
  const WALL = 104;                                   // the doors stand on this line
  const FX0 = 26, FX1 = 358, FY0 = 118, FY1 = 366;    // where feet can go
  const SPEED = 150;                                  // room pixels per second
  const FIRE = { x: 192, y: 252, r: 20 };
  const SHOPKEEPER = { x: 62, y: 300 };
  const SHOP_SPOT = { x: 64, y: 346 };                // stand here to shop
  const BLOCKS = [
    { x0: 18, x1: 108, y0: 288, y1: 330 },            // the counter
    { x0: 324, x1: 372, y0: 326, y1: 372 },           // barrels
  ];
  const NEAR = 36; // a bit stricter than the server's 44, so anything offered here is always accepted
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  const SHORT_CLUE = { fire: 'Smoke', water: 'Dripping', earth: 'Rumbling', air: 'Draft', none: 'Silent' };
  const TIER = { minor: 'Minor', major: 'Major', deadly: 'Deadly' };

  let root = null, inner = null, voice = null;
  let S = null, ui = null;
  let key = null;
  let doors = [];
  let actors = {};
  let mine = null;
  const keysDown = new Set();
  let target = null;
  let path = [];        // waypoints for tap-to-walk, routed around the fire, counter and barrels
  let active = false;
  let lastT = 0, lastSend = 0, wasMoving = false;
  let nearKey = '';
  let merchantEl = null;
  let scanning = {};          // who is scanning which door right now
  let myScan = false;
  const on = { send: null, near: null, action: null, cancelScan: null };
  const MARKS = { safe: 'Safe?', trap: 'Trap?', liar: 'Liar?' };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toNorm = (x, y) => ({ x: (x - FX0) / (FX1 - FX0), y: (y - FY0) / (FY1 - FY0) });
  const toPx = (p) => ({ x: FX0 + p.x * (FX1 - FX0), y: FY0 + p.y * (FY1 - FY0) });
  const doorX = (i, n) => (RW * (i + 1)) / (n + 1);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* ---------- mounting & scaling ---------- */
  function ensureRoot() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'room';
    inner = document.createElement('div');
    inner.className = 'room-inner';
    root.appendChild(inner);
    inner.addEventListener('pointerdown', onPointer);
    new ResizeObserver(fit).observe(document.body);
    window.addEventListener('resize', fit);
    requestAnimationFrame(frame);
  }
  function fit() {
    if (!root || !root.parentElement) return;
    const host = root.parentElement;
    const bar = document.getElementById('bar');
    const hud = document.getElementById('hud');
    const title = document.getElementById('stage-title');
    const compact = window.matchMedia('(max-height: 540px) and (orientation: landscape)').matches;
    const spare = window.innerHeight - (bar ? bar.offsetHeight : 0) - (title ? title.offsetHeight : 0) - (compact ? 0 : (hud ? hud.offsetHeight : 0)) - (compact ? 18 : 40);
    const size = Math.max(220, Math.min(host.clientWidth, spare, 720));
    root.style.width = size + 'px';
    root.style.height = size + 'px';
    inner.style.transform = `scale(${size / RW})`;
  }
  function mount(slot) {
    ensureRoot();
    if (root.parentNode !== slot) slot.appendChild(root);
    fit();
  }

  /* ---------- building the room ---------- */
  function build() {
    const d = S.match.dungeon;
    inner.innerHTML = '';
    actors = {};
    mine = null;
    doors = [];
    target = null;
    const n = d.doorsCount;
    const torches = [];
    for (let i = 0; i <= n; i++) {
      const x = i === 0 ? 14 : i === n ? RW - 14 : (doorX(i - 1, n) + doorX(i, n)) / 2;
      if (i > 0 && i < n) torches.push(x);
    }
    inner.insertAdjacentHTML('beforeend', `
      <div class="r-floor"></div>
      <div class="r-wall"></div>
      <div class="r-side l"></div><div class="r-side r"></div><div class="r-bottom"></div>
      ${torches.map((x) => `<div class="r-torch" style="left:${x}px">${Sprites.flame(2)}<i></i></div>`).join('')}
      <div class="r-banner" style="left:8px"></div><div class="r-banner" style="right:8px"></div>
      <div class="r-glow" style="left:${FIRE.x}px; top:${FIRE.y}px"></div>
      <div class="r-fire" style="left:${FIRE.x}px; top:${FIRE.y + 6}px; z-index:${FIRE.y + 6}"><div class="r-flame">${Sprites.flame(4)}</div><div class="r-logs"></div></div>
      <div class="r-keeper" style="left:${SHOPKEEPER.x}px; top:${SHOPKEEPER.y}px; z-index:${SHOPKEEPER.y}">
        <div class="say" hidden></div>
        ${Sprites.merchant(3)}
      </div>
      <div class="r-counter" style="z-index:330"><span>Shop</span></div>
      <div class="r-barrel" style="left:334px; top:332px"></div><div class="r-barrel" style="left:352px; top:346px"></div>
      <div class="r-voice" hidden></div>
      <div class="r-vignette"></div>`);
    merchantEl = inner.querySelector('.r-keeper');
    voice = inner.querySelector('.r-voice');
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'r-door';
      el.dataset.i = String(i);
      el.style.left = doorX(i, n) - 25 + 'px';
      el.innerHTML = `
        <div class="rd-plaque">${Sprites.icon('coin', 1)}<b>?</b></div>
        <div class="rd-leaf"><span class="rd-num">${ROMAN[i]}</span><span class="rd-clue"></span><span class="rd-warn"></span><span class="rd-seen"></span></div>
        <div class="sd-fx"></div>
        <div class="rd-mark" hidden></div>`;
      inner.appendChild(el);
      doors.push({ el, i, gold: el.querySelector('.rd-plaque b'), clue: el.querySelector('.rd-clue'), warn: el.querySelector('.rd-warn'), seen: el.querySelector('.rd-seen'), fx: el.querySelector('.sd-fx'), mark: el.querySelector('.rd-mark'), sig: '' });
    }
    d.advs.forEach((a) => { if (!a.left) addActor(a); });
    scanning = Object.assign({}, d.scans || {});
  }

  function colorOf(id) { return Math.max(0, S.match.dmOrder.indexOf(id)); }
  function nameOf(id) { const p = S.players.find((x) => x.id === id); return p ? p.name : '?'; }

  function addActor(a) {
    const d = S.match.dungeon;
    const p = toPx((d.pos && d.pos[a.id]) || { x: 0.5, y: 0.94 });
    const el = document.createElement('div');
    el.className = 'r-actor';
    el.innerHTML = `<div class="say" hidden></div><div class="bubble" hidden>!</div><div class="rsprite sprite"></div><div class="nameplate"><span>${esc(nameOf(a.id))}</span><i class="mini-hp"><b></b></i></div>`;
    inner.appendChild(el);
    const beam = document.createElement('div');
    beam.className = 'r-beam';
    beam.hidden = true;
    inner.appendChild(beam);
    const ac = {
      id: a.id, el, x: p.x, y: p.y, tx: p.x, ty: p.y, dir: (d.pos && d.pos[a.id] && d.pos[a.id].d) || 'up', tdir: null,
      walking: false, ghost: !a.alive, element: a.affinity, drawn: '', placed: '',
      sprite: el.querySelector('.rsprite'), say: el.querySelector('.say'), bubble: el.querySelector('.bubble'), hp: el.querySelector('.mini-hp'),
      beam,
    };
    actors[a.id] = ac;
    if (a.id === S.me) mine = ac;
    draw(ac);
    return ac;
  }

  function draw(a) {
    const look = `${a.ghost}|${a.element}|${a.dir === 'left' ? 'right' : a.dir}`;
    if (look !== a.drawn) {
      a.drawn = look;
      a.sprite.innerHTML = a.ghost ? Sprites.ghost(colorOf(a.id), 3) : Sprites.walker(colorOf(a.id), a.element, a.dir, 3);
      a.el.classList.toggle('is-ghost', a.ghost);
    }
    a.sprite.classList.toggle('flip', a.dir === 'left');
    a.sprite.classList.toggle('walk', a.walking && !a.ghost);
    const place = `${Math.round(a.x * 10)}|${Math.round(a.y * 10)}`;
    if (place !== a.placed) {
      a.placed = place;
      a.el.style.left = a.x + 'px';
      a.el.style.top = a.y + 'px';
      a.el.style.zIndex = String(Math.round(a.y));
    }
    // a lantern beam from their hand to the door they're scanning: the same warm white for everyone
    const door = scanning[a.id];
    a.beam.hidden = door === undefined;
    if (door !== undefined) {
      const n = S.match.dungeon.doorsCount;
      const hx = a.x, hy = a.y - 26, tx = doorX(door, n), ty = 70;
      const len = Math.hypot(tx - hx, ty - hy);
      a.beam.style.left = hx + 'px';
      a.beam.style.top = hy + 'px';
      a.beam.style.width = len + 'px';
      a.beam.style.transform = `rotate(${Math.atan2(ty - hy, tx - hx)}rad)`;
    }
  }

  /* ---------- doors and people, refreshed from the server's state ---------- */
  function refresh() {
    const d = S.match.dungeon;
    const phase = S.phase, role = d.role;
    scanning = Object.assign({}, phase === 'adv' ? d.scans || {} : {});
    doors.forEach((door, i) => {
      let face = { unknown: true }, seen = null, warn = null, selected = false;
      if (phase === 'adv' && d.doors) {
        face = { gold: d.doors[i].gold, clue: d.doors[i].clue };
        if (face.clue === null) face.hidden = true;
        if (role === 'dm' && d.dm && d.dm.doors) seen = { trap: d.dm.doors[i].trap, illusion: d.dm.doors[i].illusion !== null };
        if (role === 'ghost' && d.sight) seen = { trap: d.sight[i].trap, illusion: d.sight[i].illusion !== null };
        if (role === 'adv') {
          const aff = d.mine.affinity;
          if (aff && face.clue && face.clue !== 'none') warn = face.clue === aff ? 'resist' : S.config.WEAK_TO[aff] === face.clue ? 'weak' : null;
          const k = d.mine.known && d.mine.known[i];
          if (k && k.lens) seen = { trap: k.lens.trap, illusion: k.lens.illusion, lens: true };
          selected = ui.adv && ui.adv.door === i && !ui.adv.resting;
        }
      }
      const mark = role === 'adv' && phase === 'adv' && ui.marks ? ui.marks[i] || null : null;
      const lit = Object.values(scanning).includes(i);
      door.el.classList.toggle('lit', lit);
      const sig = JSON.stringify([face, seen, warn, selected, mark]);
      if (sig === door.sig) return;
      door.sig = sig;
      door.el.classList.toggle('sealed', !!face.unknown);
      door.el.classList.toggle('selected', selected);
      door.mark.hidden = !mark;
      door.mark.textContent = mark ? MARKS[mark] : '';
      door.mark.className = 'rd-mark' + (mark ? ' m-' + mark : '');
      door.gold.textContent = face.unknown ? '?' : face.gold;
      const quiet = face.unknown || face.hidden;
      door.clue.textContent = face.unknown ? '' : face.hidden ? '?' : SHORT_CLUE[face.clue];
      door.clue.className = 'rd-clue' + (face.unknown ? '' : face.hidden ? ' unscanned' : ` el-${face.clue}`);
      door.fx.className = 'sd-fx' + (quiet || face.clue === 'none' ? '' : ` fx-${face.clue}`);
      door.fx.innerHTML = quiet || face.clue === 'none' ? '' : '<i></i><i></i><i></i>';
      door.warn.textContent = warn === 'weak' ? 'Weak' : warn === 'resist' ? 'Resist' : '';
      door.warn.className = 'rd-warn' + (warn ? ' ' + warn : '');
      door.seen.innerHTML = !seen ? '' : (seen.lens ? Sprites.icon('eye', 1) : '') + (seen.trap ? `${Sprites.icon(seen.trap.element, 1)}<span class="el-${seen.trap.element}">${TIER[seen.trap.tier]}</span>` : '<span>No trap</span>') + (seen.illusion ? '<span class="ill">Fake</span>' : '');
      door.el.setAttribute('aria-label', face.unknown ? `Door ${ROMAN[i]}, sealed` : face.hidden ? `Door ${ROMAN[i]}: ${face.gold} gold, not scanned` : `Door ${ROMAN[i]}: ${face.gold} gold, ${SHORT_CLUE[face.clue].toLowerCase()}${warn === 'weak' ? ', you are weak to it' : warn === 'resist' ? ', you resist it' : ''}`);
    });

    const here = new Set();
    d.advs.forEach((a) => {
      if (a.left) return;
      here.add(a.id);
      const ac = actors[a.id] || addActor(a);
      ac.ghost = !a.alive;
      if (a.alive) ac.element = a.affinity;
      ac.hp.hidden = !a.alive;
      const pct = Math.max(0, Math.min(100, a.hp));
      ac.hp.firstElementChild.style.width = pct + '%';
      ac.hp.firstElementChild.className = pct <= 30 ? 'low' : pct <= 60 ? 'mid' : '';
      ac.bubble.hidden = !((phase === 'setup' || phase === 'adv') && a.ready && a.id !== S.me);
      const p = d.pos && d.pos[a.id];
      if (p && ac !== mine) setTarget(ac, p);
      if (ac === mine && p && !wasMoving && !target && dist(ac, toPx(p)) > 40) { ac.x = toPx(p).x; ac.y = toPx(p).y; }
      draw(ac);
    });
    Object.keys(actors).forEach((id) => {
      if (!here.has(id)) { actors[id].el.remove(); if (actors[id] === mine) mine = null; delete actors[id]; }
    });
    root.classList.toggle('can-walk', canWalk());
  }

  function setTarget(ac, p) {
    const q = toPx(p);
    ac.tx = q.x;
    ac.ty = q.y;
    ac.tdir = p.d || null;
    if (dist(ac, q) > 160) { ac.x = q.x; ac.y = q.y; }
  }

  /* ---------- movement ---------- */
  function canWalk() {
    if (!S || !S.match || !S.match.dungeon || !mine) return false;
    const d = S.match.dungeon;
    return ['setup', 'dm', 'adv'].includes(S.phase) && (d.role === 'adv' || d.role === 'ghost');
  }
  function blocked(x, y, ghost) {
    if (x < FX0 || x > FX1 || y < FY0 || y > FY1) return true;
    if (ghost) return false;
    if (Math.hypot(x - FIRE.x, y - FIRE.y) < FIRE.r + 10) return true;
    return BLOCKS.some((b) => x > b.x0 - 8 && x < b.x1 + 8 && y > b.y0 - 4 && y < b.y1 + 4);
  }
  /* ---------- tap-to-walk routes around obstacles ---------- */
  const CELL = 12;
  function clearLine(a, b) {
    const n = Math.max(1, Math.ceil(dist(a, b) / 4));
    for (let k = 1; k <= n; k++) {
      if (blocked(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, false)) return false;
    }
    return true;
  }
  function route(from, to) {
    if (mine && mine.ghost) return [to];
    if (clearLine(from, to)) return [to];
    const cols = Math.floor((FX1 - FX0) / CELL) + 1, rows = Math.floor((FY1 - FY0) / CELL) + 1;
    const pt = (c, r2) => ({ x: FX0 + c * CELL, y: FY0 + r2 * CELL });
    const cellOf = (p) => [Math.max(0, Math.min(cols - 1, Math.round((p.x - FX0) / CELL))), Math.max(0, Math.min(rows - 1, Math.round((p.y - FY0) / CELL)))];
    const free = (c, r2) => c >= 0 && r2 >= 0 && c < cols && r2 < rows && !blocked(pt(c, r2).x, pt(c, r2).y, false);
    let [gc, gr] = cellOf(to);
    if (!free(gc, gr)) {
      // the spot itself is blocked: aim for the nearest open spot
      let best = null, bd = Infinity;
      for (let c = 0; c < cols; c++) for (let r2 = 0; r2 < rows; r2++) {
        if (!free(c, r2)) continue;
        const dd = dist(pt(c, r2), to);
        if (dd < bd) { bd = dd; best = [c, r2]; }
      }
      if (!best) return [];
      [gc, gr] = best;
      to = pt(gc, gr);
    }
    const [sc, sr] = cellOf(from);
    const key = (c, r2) => r2 * cols + c;
    const open = [[sc, sr]], came = new Map(), g = new Map([[key(sc, sr), 0]]);
    let found = false;
    while (open.length) {
      open.sort((p, q) => (g.get(key(p[0], p[1])) + Math.hypot(p[0] - gc, p[1] - gr)) - (g.get(key(q[0], q[1])) + Math.hypot(q[0] - gc, q[1] - gr)));
      const [c, r2] = open.shift();
      if (c === gc && r2 === gr) { found = true; break; }
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nc = c + dc, nr = r2 + dr;
        if (!free(nc, nr)) continue;
        if (dc && dr && (!free(c + dc, r2) || !free(c, r2 + dr))) continue;
        const ng = g.get(key(c, r2)) + Math.hypot(dc, dr);
        if (ng < (g.has(key(nc, nr)) ? g.get(key(nc, nr)) : Infinity)) {
          g.set(key(nc, nr), ng);
          came.set(key(nc, nr), [c, r2]);
          open.push([nc, nr]);
        }
      }
    }
    if (!found) return [to];
    const cells = [];
    let cur = [gc, gr];
    while (cur && !(cur[0] === sc && cur[1] === sr)) { cells.unshift(pt(cur[0], cur[1])); cur = came.get(key(cur[0], cur[1])); }
    cells.push(to);
    // smooth it: skip ahead to the farthest waypoint we can walk to in a straight line
    const out = [];
    let here = from, k = 0;
    while (k < cells.length) {
      let j = cells.length - 1;
      while (j > k && !clearLine(here, cells[j])) j--;
      out.push(cells[j]);
      here = cells[j];
      k = j + 1;
    }
    return out;
  }
  function goTo(p) {
    if (!mine) return;
    path = route({ x: mine.x, y: mine.y }, p);
    target = path.shift() || null;
  }

  function stepMine(dt, t) {
    if (!canWalk()) { if (mine) mine.walking = false; return; }
    let vx = 0, vy = 0;
    if (keysDown.has('left')) vx -= 1;
    if (keysDown.has('right')) vx += 1;
    if (keysDown.has('up')) vy -= 1;
    if (keysDown.has('down')) vy += 1;
    if (vx || vy) { target = null; path = []; }
    if (myScan && (vx || vy || target)) {
      myScan = false;
      if (on.cancelScan) on.cancelScan();
    }
    if (vx || vy) { /* keys win */ }
    else if (target) {
      const dx = target.x - mine.x, dy = target.y - mine.y, dd = Math.hypot(dx, dy);
      if (dd < 2) target = path.shift() || null;
      else { vx = dx / dd; vy = dy / dd; }
    }
    let moved = false;
    if (vx || vy) {
      const len = Math.hypot(vx, vy);
      vx /= len; vy /= len;
      let step = SPEED * dt;
      if (target) step = Math.min(step, dist(mine, target));
      const nx = mine.x + vx * step, ny = mine.y + vy * step;
      if (!blocked(nx, mine.y, mine.ghost)) { mine.x = nx; moved = true; }
      if (!blocked(mine.x, ny, mine.ghost)) { mine.y = ny; moved = true; }
      if (!moved) { target = null; path = []; }
      mine.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : (vy < 0 ? 'up' : 'down');
    }
    mine.walking = moved;
    if (moved && t - lastSend > 90) send(t);
    if (!moved && wasMoving) send(t);
    wasMoving = moved;
  }
  function send(t) {
    lastSend = t;
    const p = toNorm(mine.x, mine.y);
    if (on.send) on.send({ x: p.x, y: p.y, d: mine.dir });
  }
  function stepOther(a, dt) {
    const dx = a.tx - a.x, dy = a.ty - a.y, dd = Math.hypot(dx, dy);
    if (dd > 0.6) {
      const sp = Math.min(dd, Math.max(SPEED * 1.15, dd * 6) * dt);
      a.x += (dx / dd) * sp;
      a.y += (dy / dd) * sp;
      a.walking = true;
      a.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
    } else {
      a.walking = false;
      if (a.tdir) a.dir = a.tdir;
    }
  }
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    if (!active || !S || !S.match || !S.match.dungeon) return;
    // walk the same speed however fast the screen redraws: catch up in small steps
    let left = Math.min(0.5, Math.max(0, (t - (frame.prev || t)) / 1000));
    frame.prev = t;
    while (left > 0) {
      const step = Math.min(0.03, left);
      if (mine) stepMine(step, t);
      for (const a of Object.values(actors)) if (a !== mine) stepOther(a, step);
      left -= step;
    }
    for (const a of Object.values(actors)) draw(a);
    checkNear();
  }

  /* ---------- what's next to me: drives the action button ---------- */
  function checkNear() {
    let n = null;
    if (canWalk()) {
      const phase = S.phase;
      const alive = !mine.ghost;
      const nd = S.match.dungeon.doorsCount;
      if (alive && dist(mine, SHOP_SPOT) < 40) n = { type: 'shop' };
      if (!n && alive && phase === 'adv' && mine.y < WALL + 42) {
        for (let i = 0; i < nd; i++) if (Math.abs(mine.x - doorX(i, nd)) < 28) n = { type: 'door', i };
      }
      if (!n && alive && phase === 'adv' && dist(mine, FIRE) < 52) n = { type: 'fire' };
      if (!n) {
        let best = null, bd = NEAR + 0.01;
        for (const a of Object.values(actors)) {
          if (a === mine) continue;
          const dd = dist(a, mine);
          if (dd < bd) { bd = dd; best = a; }
        }
        if (best) n = { type: 'person', id: best.id };
      }
    }
    const k = n ? JSON.stringify(n) : '';
    if (k !== nearKey) {
      nearKey = k;
      if (on.near) on.near(n);
    }
  }

  /* ---------- tapping and keys ---------- */
  function roomPoint(e) {
    const r = inner.getBoundingClientRect();
    const s = r.width / RW;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  }
  function onPointer(e) {
    if (!canWalk() || e.button > 0) return;
    const pt = roomPoint(e);
    for (const a of Object.values(actors)) {
      if (a === mine) continue;
      if (Math.abs(pt.x - a.x) < 16 && pt.y > a.y - 46 && pt.y < a.y + 4) {
        goTo({ x: Math.max(FX0, Math.min(FX1, a.x + (a.x > mine.x ? -26 : 26))), y: a.y });
        return;
      }
    }
    if (pt.x < 110 && pt.y > 250 && pt.y < 334) { goTo({ ...SHOP_SPOT }); return; }
    const nd = S.match.dungeon.doorsCount;
    if (pt.y < WALL + 8) {
      for (let i = 0; i < nd; i++) if (Math.abs(pt.x - doorX(i, nd)) < 30) { goTo({ x: doorX(i, nd), y: WALL + 22 }); return; }
      return;
    }
    goTo({ x: Math.max(FX0, Math.min(FX1, pt.x)), y: Math.max(FY0, Math.min(FY1, pt.y)) });
  }
  const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
  window.addEventListener('keydown', (e) => {
    if (!active || !canWalk()) return;
    const tag = (e.target && e.target.tagName) || '';
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || document.querySelector('.modal')) return;
    if (KEYMAP[e.key]) { keysDown.add(KEYMAP[e.key]); e.preventDefault(); }
    else if ((e.key === 'e' || e.key === 'E') && on.action) { e.preventDefault(); on.action(); }
  });
  window.addEventListener('keyup', (e) => { if (KEYMAP[e.key]) keysDown.delete(KEYMAP[e.key]); });
  window.addEventListener('blur', () => keysDown.clear());

  /* ---------- talking ---------- */
  function say(id, text, kind = '') {
    let el = null;
    if (id === 'merchant') el = merchantEl && merchantEl.querySelector('.say');
    else if (actors[id]) el = actors[id].say;
    else if (S && S.match && S.match.dungeon && S.match.dungeon.dmId === id && voice) {
      // the DM isn't in the room: their voice comes from above
      voice.textContent = 'DM: ' + text;
      voice.hidden = false;
      clearTimeout(voice._t);
      voice._t = setTimeout(() => { voice.hidden = true; }, 3400);
      return;
    }
    if (!el) return;
    if (kind === 'huddle' && !el.hidden && !el.classList.contains('huddle')) return;
    el.textContent = text;
    el.className = 'say ' + kind + (id === 'merchant' ? ' anchor-left' : '');
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, kind === 'huddle' ? 2200 : 3400);
  }

  function update(state, uiState) {
    S = state;
    ui = uiState;
    if (!root || !S.match || !S.match.dungeon) return;
    const d = S.match.dungeon;
    const k = `${S.match.dIndex}:${d.round}:${d.doorsCount}`;
    if (k !== key) { key = k; build(); }
    refresh();
  }
  function setActive(v) {
    active = v;
    if (!v) { keysDown.clear(); target = null; path = []; }
    if (root) fit();
  }
  function setPos(id, p) {
    const a = actors[id];
    if (a && a !== mine) setTarget(a, p);
  }
  function walkTo(p) {
    if (canWalk()) goTo(toPx(p));
  }
  function setScan(id, door, isOn) {
    if (isOn) scanning[id] = door; else delete scanning[id];
    const a = actors[id];
    if (a) draw(a);
    doors.forEach((d) => d.el.classList.toggle('lit', Object.values(scanning).includes(d.i)));
  }
  function setMyScan(v) { myScan = !!v; if (v) { target = null; path = []; } }
  return {
    mount, update, setActive, setPos, say, walkTo, fit, setScan, setMyScan,
    onCancelScan: (fn) => { on.cancelScan = fn; },
    onSend: (fn) => { on.send = fn; },
    onNear: (fn) => { on.near = fn; },
    onAction: (fn) => { on.action = fn; },
    myPos: () => (mine ? toNorm(mine.x, mine.y) : null),
    // who is standing right next to me, by where they are on screen
    nearPeople: () => (mine ? Object.values(actors).filter((a) => a !== mine && dist(a, mine) <= NEAR).sort((p, q) => dist(p, mine) - dist(q, mine)).map((a) => a.id) : []),
  };
})();
