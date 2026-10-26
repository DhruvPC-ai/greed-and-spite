'use strict';
/* The dungeon scene: wall, doors, torches, campfire, adventurers, and the animated reveal. */
const Scene = (() => {
  const H = 360;
  const FLOOR = 245;
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  const SHORT_CLUE = { fire: 'Smoke', water: 'Dripping', earth: 'Rumbling', air: 'Draft', none: 'Silent' };
  const TIER = { minor: 'Minor', major: 'Major', deadly: 'Deadly' };
  const DUR = { sprint: 700, lock: 650, walk: 1150, sneak: 1650 };

  let W = 800;
  let root = null, inner = null, fx = null;
  let key = null, last = null, geom = null;
  let doors = [], actors = {};
  let playing = null;
  let listener = null;

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sfx = (on, name, ...args) => { if (on && window.Sound) Sound.play(name, ...args); };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

  /* ---------- mounting & scaling ---------- */
  function ensureRoot() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'scene';
    inner = document.createElement('div');
    inner.className = 'scene-inner';
    root.appendChild(inner);
    new ResizeObserver(fit).observe(root);
  }
  function fit() {
    const w = root.clientWidth;
    if (!w) return;
    const want = w < 620 ? 440 : 800;
    if (want !== W) {
      W = want;
      key = null;
      if (last) update(last.S, last.ui);
    }
    const s = w / W;
    inner.style.width = W + 'px';
    inner.style.height = H + 'px';
    inner.style.transform = `scale(${s})`;
    root.style.height = H * s + 'px';
  }
  function mount(slot) {
    ensureRoot();
    if (root.parentNode !== slot) slot.appendChild(root);
    fit();
  }

  /* ---------- geometry ---------- */
  function computeGeom(nDoors, advIds) {
    const narrow = W < 700;
    const camp = { x: narrow ? 50 : 74, y: H - 30 };
    const left = narrow ? 108 : 168;
    const right = W - 14;
    const sp = (right - left) / nDoors;
    const dw = Math.round(Math.min(100, sp * 0.7));
    const dh = Math.round(dw * 1.6);
    const ds = Array.from({ length: nDoors }, (_, i) => ({ cx: left + sp * (i + 0.5), dw, dh }));
    const x0 = camp.x + 80, x1 = W - 42;
    const hall = {};
    advIds.forEach((id, k) => {
      const m = advIds.length;
      hall[id] = { x: m === 1 ? (x0 + x1) / 2 : x0 + (k * (x1 - x0)) / (m - 1), y: H - 34 };
    });
    const torches = [];
    for (let i = 1; i < nDoors; i++) torches.push(left + sp * i);
    torches.push(left - (narrow ? 6 : 14));
    return { camp, doors: ds, hall, sp, torches, narrow };
  }
  function doorFront(i, j, cnt, row) {
    const g = geom.doors[i];
    const gap = Math.min(30, g.dw * 0.42);
    return { x: g.cx + (j - (cnt - 1) / 2) * gap, y: FLOOR + 36 + row * 26 };
  }
  function campSpot(j) {
    return { x: geom.camp.x + 50 + j * 44, y: H - 30 };
  }
  // everyone at one door stands side by side, in the order they got there
  function crowdSpot(i, k, n, back) {
    const g = geom.doors[i];
    const gap = n > 1 ? Math.min(46, (geom.sp * 0.95) / (n - 1)) : 0;
    return { x: g.cx + (k - (n - 1) / 2) * gap, y: FLOOR + 36 + (back ? 14 : 0) };
  }
  function ghostHome(id) {
    const h = geom.hall[id];
    return { x: h.x, y: FLOOR + 62 };
  }

  /* ---------- small builders ---------- */
  function backdrop(d, S) {
    const torches = geom.torches.map((x) => `
      <div class="torch" style="left:${x}px; top:${FLOOR - geom.doors[0].dh * 0.72}px">
        <div class="torch-glow"></div>
        <div class="torch-flame">${Sprites.flame(3)}</div>
        <div class="torch-stick"></div>
      </div>`).join('');
    const dmName = S.players.find((p) => p.id === d.dmId);
    return `
      <div class="wall"></div>
      <div class="floor" style="top:${FLOOR}px"></div>
      <div class="wall-base" style="top:${FLOOR - 6}px"></div>
      ${torches}
      <div class="campfire" style="left:${geom.camp.x}px; top:${geom.camp.y}px">
        <div class="camp-glow"></div>
        <div class="camp-flame">${Sprites.flame(5)}</div>
        <div class="camp-logs"></div>
      </div>
      <div class="dm" style="left:${geom.camp.x}px">
        <div class="dm-hood">${Sprites.dmHood(geom.narrow ? 4 : 5)}</div>
        <div class="dm-name">DM ${esc(dmName ? dmName.name : '')}</div>
      </div>
      <div class="vignette"></div>`;
  }

  function createDoor(i, g) {
    const el = document.createElement('div');
    el.className = 'sdoor';
    el.style.cssText = `left:${g.cx - g.dw / 2}px; top:${FLOOR - g.dh}px; width:${g.dw}px; height:${g.dh}px;`;
    el.innerHTML = `
      <div class="sd-frame"></div>
      <div class="sd-inside"><span class="sd-inside-icon"></span></div>
      <div class="sd-fx"></div>
      <button class="sd-leaf" type="button" data-i="${i}" disabled>
        <span class="sd-num">${ROMAN[i]}</span>
        <span class="sd-clue"></span>
        <span class="sd-band b1"></span><span class="sd-band b2"></span>
        <span class="sd-ring"></span>
      </button>
      <div class="sd-plaque"><span class="sd-coin">${Sprites.icon('coin', 2)}</span><b class="sd-gold">?</b></div>
      <div class="sd-seen" hidden></div>
      <div class="sd-mark"></div>`;
    inner.appendChild(el);
    return {
      i, g, el,
      leaf: el.querySelector('.sd-leaf'),
      clue: el.querySelector('.sd-clue'),
      fx: el.querySelector('.sd-fx'),
      gold: el.querySelector('.sd-gold'),
      seen: el.querySelector('.sd-seen'),
      inside: el.querySelector('.sd-inside-icon'),
      mark: el.querySelector('.sd-mark'),
      faceSig: null, seenSig: null,
    };
  }

  function setDoorFace(door, face) {
    const sig = JSON.stringify(face);
    if (sig === door.faceSig) return;
    door.faceSig = sig;
    if (!face || face.unknown) {
      door.gold.textContent = '?';
      door.clue.textContent = '';
      door.clue.className = 'sd-clue';
      door.fx.className = 'sd-fx';
      door.fx.innerHTML = '';
      door.leaf.setAttribute('aria-label', `Door ${ROMAN[door.i]}`);
      return;
    }
    door.gold.textContent = face.gold;
    door.clue.textContent = SHORT_CLUE[face.clue];
    door.clue.className = `sd-clue el-${face.clue}`;
    door.fx.className = `sd-fx fx-${face.clue}`;
    door.fx.innerHTML = face.clue === 'none' ? '' : '<i></i><i></i><i></i>';
    door.leaf.setAttribute('aria-label', `Door ${ROMAN[door.i]}: ${face.gold} gold, ${SHORT_CLUE[face.clue].toLowerCase()}`);
  }

  function setSeen(door, seen) {
    const sig = JSON.stringify(seen);
    if (sig === door.seenSig) return;
    door.seenSig = sig;
    if (!seen) { door.seen.hidden = true; door.seen.innerHTML = ''; return; }
    door.seen.hidden = false;
    const t = seen.trap;
    door.seen.innerHTML =
      (seen.lens ? '<span class="seen-src">Lens</span>' : '') +
      (t ? `${Sprites.icon(t.element, 2)}<span class="el-${t.element}">${TIER[t.tier]}</span>` : '<span>No trap</span>') +
      (seen.illusion ? '<span class="seen-ill">Illusion</span>' : '');
  }

  function setClickable(door, clickable, selected) {
    door.leaf.disabled = !clickable;
    if (clickable) door.leaf.dataset.act = 'pickDoor';
    else delete door.leaf.dataset.act;
    door.el.classList.toggle('selected', !!selected);
    door.leaf.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }

  /* ---------- actors ---------- */
  function makeActor(id, name, colorIdx, element, alive, pos) {
    const el = document.createElement('div');
    el.className = 'actor';
    el.innerHTML = `
      <div class="actor-body">
        <div class="bubble" hidden>!</div>
        <div class="pose"><div class="sprite"></div></div>
      </div>
      <div class="nameplate"><span>${esc(name)}</span><i class="mini-hp"><b></b></i></div>`;
    inner.appendChild(el);
    const a = {
      id, el, colorIdx, element, ghost: !alive, sitting: false,
      body: el.querySelector('.actor-body'),
      pose: el.querySelector('.pose'),
      sprite: el.querySelector('.sprite'),
      bubble: el.querySelector('.bubble'),
      hp: el.querySelector('.mini-hp'),
      x: pos.x, y: pos.y, moveAnim: null,
    };
    drawSprite(a);
    place(a, pos.x, pos.y);
    actors[id] = a;
    return a;
  }
  function drawSprite(a) {
    a.el.classList.toggle('is-ghost', a.ghost);
    if (a.ghost) a.sprite.innerHTML = Sprites.ghost(a.colorIdx, 4);
    else if (a.sitting) a.sprite.innerHTML = Sprites.sitting(a.colorIdx, a.element, 4);
    else a.sprite.innerHTML = Sprites.adventurer(a.colorIdx, a.element, 4);
  }
  function place(a, x, y) {
    a.x = x; a.y = y;
    a.el.style.left = x + 'px';
    a.el.style.top = y + 'px';
    a.el.style.zIndex = String(100 + Math.round(y));
  }
  function setHp(a, hp, alive) {
    a.hp.hidden = !alive;
    const pct = Math.max(0, Math.min(100, hp));
    const b = a.hp.firstElementChild;
    b.style.width = pct + '%';
    b.className = pct <= 30 ? 'low' : pct <= 60 ? 'mid' : '';
  }
  function moveTo(a, x, y, ms, gait, animate) {
    if (a.moveAnim) { try { a.moveAnim.finish(); } catch (e) { /* already done */ } }
    const fx0 = a.x, fy0 = a.y;
    if (Math.abs(x - fx0) > 1) a.body.classList.toggle('face-left', x < fx0);
    place(a, x, y);
    if (!animate || ms <= 0 || (Math.abs(x - fx0) < 1 && Math.abs(y - fy0) < 1)) return Promise.resolve();
    if (gait !== 'float') {
      a.sprite.classList.add('walk');
      a.sprite.classList.toggle('run', gait === 'sprint' || gait === 'lock');
      a.pose.classList.toggle('sneak', gait === 'sneak');
    }
    const anim = a.el.animate([{ left: fx0 + 'px', top: fy0 + 'px' }, { left: x + 'px', top: y + 'px' }],
      { duration: ms, easing: gait === 'float' ? 'ease-in-out' : 'linear' });
    a.moveAnim = anim;
    return anim.finished.catch(() => {}).then(() => {
      if (a.moveAnim === anim) a.moveAnim = null;
      a.sprite.classList.remove('walk', 'run');
      a.pose.classList.remove('sneak');
    });
  }

  /* ---------- effects ---------- */
  function floatText(x, y, text, cls, animate, delay = 0) {
    if (!animate) return;
    const el = document.createElement('div');
    el.className = 'float ' + (cls || '');
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    fx.appendChild(el);
    el.animate([{ transform: 'translate(-50%, 0)', opacity: 0 }, { transform: 'translate(-50%, -12px)', opacity: 1, offset: 0.15 }, { transform: 'translate(-50%, -44px)', opacity: 0 }],
      { duration: 1500, delay, easing: 'ease-out', fill: 'both' }).finished.catch(() => {}).then(() => el.remove());
  }
  const overHead = (a) => ({ x: a.x, y: a.y - 74 });

  function particle(x, y, cls, size, color) {
    const p = document.createElement('i');
    p.className = 'pt ' + (cls || '');
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.width = p.style.height = size + 'px';
    if (color) p.style.background = color;
    fx.appendChild(p);
    return p;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  function trapFx(door, trap, animate) {
    if (!animate) return;
    const g = door.g;
    const cx = g.cx, top = FLOOR - g.dh, mid = FLOOR - g.dh / 2;
    const n = Math.round({ minor: 14, major: 20, deadly: 28 }[trap.tier]);
    const anims = [];
    const parts = [];
    const flash = particle(cx - g.dw / 2, top, 'flash flash-' + trap.element, 0);
    parts.push(flash);
    flash.style.width = g.dw + 'px';
    flash.style.height = g.dh + 'px';
    anims.push(flash.animate([{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }], { duration: 600 }));
    for (let k = 0; k < n; k++) {
      let p, kf, dur = rnd(650, 1000);
      if (trap.element === 'fire') {
        p = particle(cx + rnd(-g.dw / 3, g.dw / 3), FLOOR - rnd(10, g.dh * 0.6), '', rnd(6, 11), ['#ff9a2e', '#ffd45e', '#e8552b'][k % 3]);
        kf = [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${rnd(-70, 70)}px, ${rnd(-150, -60)}px) scale(.3)`, opacity: 0 }];
      } else if (trap.element === 'water') {
        p = particle(cx + rnd(-g.dw / 3, g.dw / 3), mid + rnd(-20, 30), '', rnd(5, 9), ['#55a6ec', '#bfe3ff', '#3d8ee0'][k % 3]);
        const dx = rnd(-120, 120);
        kf = [{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${dx * 0.5}px, ${rnd(-80, -30)}px)`, opacity: 1, offset: 0.4 }, { transform: `translate(${dx}px, ${rnd(70, 110)}px)`, opacity: 0 }];
      } else if (trap.element === 'earth') {
        p = particle(cx + rnd(-g.dw / 2, g.dw / 2), top - rnd(0, 30), 'rock', rnd(8, 14), ['#b0864b', '#8a6a3a', '#6b4c27'][k % 3]);
        kf = [{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${rnd(-40, 40)}px, ${g.dh + rnd(20, 60)}px) rotate(${rnd(-180, 180)}deg)`, opacity: 1, offset: 0.8 }, { transform: `translate(${rnd(-50, 50)}px, ${g.dh + rnd(10, 40)}px) rotate(${rnd(-180, 180)}deg)`, opacity: 0 }];
        dur = rnd(700, 950);
      } else {
        p = particle(cx, mid + rnd(-g.dh / 3, g.dh / 2), 'streak', 4, ['#8ad8c6', '#e8fff9'][k % 2]);
        p.style.width = rnd(16, 34) + 'px';
        const dir = k % 2 ? 1 : -1;
        kf = [{ transform: 'translate(0,0)', opacity: 0.9 }, { transform: `translate(${dir * rnd(90, 190)}px, ${rnd(-20, 20)}px)`, opacity: 0 }];
      }
      parts.push(p);
      anims.push(p.animate(kf, { duration: dur, delay: rnd(0, 180), easing: 'ease-out', fill: 'both' }));
    }
    Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => parts.forEach((x) => x.remove()));
    if (trap.tier === 'deadly') {
      inner.animate([{ transform: inner.style.transform }, { transform: inner.style.transform + ' translate(5px, 2px)' }, { transform: inner.style.transform + ' translate(-5px, -2px)' }, { transform: inner.style.transform + ' translate(3px, 1px)' }, { transform: inner.style.transform }], { duration: 380 });
    }
  }

  function coins(from, to, count, animate, delay = 0) {
    if (!animate) return;
    for (let k = 0; k < count; k++) {
      const el = document.createElement('div');
      el.className = 'flycoin';
      el.innerHTML = Sprites.icon('coin', 2);
      el.style.left = from.x + 'px';
      el.style.top = from.y + 'px';
      fx.appendChild(el);
      const dx = to.x - from.x + rnd(-6, 6), dy = to.y - from.y;
      el.animate([
        { transform: 'translate(-50%,-50%)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 60}px))`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`, opacity: 0.4 },
      ], { duration: 650, delay: delay + k * 70, easing: 'ease-in-out', fill: 'both' }).finished.catch(() => {}).then(() => el.remove());
    }
  }

  function hit(a, animate) {
    if (!animate) return;
    a.sprite.animate([{ filter: 'none' }, { filter: 'brightness(2.2) saturate(0) sepia(1) hue-rotate(-50deg) saturate(6)' }, { filter: 'none' }, { filter: 'brightness(2.2) saturate(0) sepia(1) hue-rotate(-50deg) saturate(6)' }, { filter: 'none' }], { duration: 520 });
    a.pose.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 360 });
  }
  function lunge(a, target, animate) {
    if (!animate) return;
    const dx = Math.max(-26, Math.min(26, target.x - a.x));
    a.pose.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${dx}px, -6px)` }, { transform: 'translate(0,0)' }], { duration: 420, easing: 'ease-out' });
    target.pose.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(0,-14px)', offset: 0.6 }, { transform: 'translate(0,0)' }], { duration: 480, delay: 160 });
  }
  function knock(a, animate) {
    if (!animate) return;
    a.pose.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(0,-8px)' }, { transform: 'translate(0,10px)' }, { transform: 'translate(0,0)' }], { duration: 420 });
  }
  function openDoor(door, trap, animate) {
    door.el.classList.add('open');
    door.fx.className = 'sd-fx';
    door.fx.innerHTML = '';
    door.inside.innerHTML = trap ? Sprites.icon(trap.element, door.g.dw > 70 ? 5 : 4) : '';
    door.el.classList.toggle('empty', !trap);
    if (animate) door.leaf.animate([{ transform: 'perspective(500px) rotateY(0deg)' }, { transform: 'perspective(500px) rotateY(-78deg)' }], { duration: 520, easing: 'ease-out' });
  }

  /* ---------- the round reveal ---------- */
  function newPlay() {
    const p = { skip: false, waiters: new Set() };
    playing = p;
    if (listener) listener();
    return p;
  }
  function wait(p, ms) {
    if (p.skip) return Promise.resolve();
    return new Promise((res) => {
      const done = () => { clearTimeout(t); p.waiters.delete(done); res(); };
      const t = setTimeout(done, ms);
      p.waiters.add(done);
    });
  }
  function skip() {
    if (!playing) return;
    playing.skip = true;
    [...playing.waiters].forEach((f) => f());
    inner.getAnimations({ subtree: true }).forEach((a) => {
      if (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) return;
      try { a.finish(); } catch (e) { a.cancel(); }
    });
    fx.innerHTML = '';
  }

  async function playResult(S, r, instant) {
    const p = newPlay();
    if (instant || reduced()) p.skip = true;
    const anim = () => !p.skip;
    const d = S.match.dungeon;
    const living = d.advIds.filter((id) => r.before[id].hp > 0);

    // where everyone goes
    const plan = {};
    r.doors.forEach((info) => {
      const lockers = info.entrants.filter((id) => r.act[id].lock);
      const front = lockers.length ? lockers : info.triggered.length ? info.triggered : info.entrants;
      const back = info.entrants.filter((id) => !front.includes(id));
      const order = front.concat(back);
      order.forEach((id, k) => (plan[id] = { ...crowdSpot(info.index, k, order.length, back.includes(id)), gait: r.act[id].lock ? 'lock' : r.act[id].approach }));
    });
    const resters = living.filter((id) => r.act[id].type === 'rest');
    resters.forEach((id, j) => (plan[id] = { ...campSpot(j), gait: 'walk', rest: true }));

    // 1. everyone moves; speed shows who arrives first
    await wait(p, 300);
    sfx(anim(), 'march', 9, 0.17);
    await Promise.all(living.map((id) => {
      const t = plan[id];
      if (!t) return Promise.resolve();
      return moveTo(actors[id], t.x, t.y, t.rest ? 1000 : DUR[t.gait], t.gait, anim());
    }));
    resters.forEach((id) => { const a = actors[id]; a.sitting = true; drawSprite(a); });
    await wait(p, 250);

    // 2. locks and shoves
    let any = false;
    r.doors.forEach((info) => {
      const door = doors[info.index];
      const lockers = info.entrants.filter((id) => r.act[id].lock);
      if (lockers.length) {
        any = true;
        door.mark.innerHTML = Sprites.icon('lock', 3);
        sfx(anim(), 'lock');
        if (anim()) door.mark.animate([{ transform: 'translate(-50%, 0) scale(2)', opacity: 0 }, { transform: 'translate(-50%, 0) scale(1)', opacity: 1 }], { duration: 300 });
        info.lockedOut.forEach((id) => { knock(actors[id], anim()); const o = overHead(actors[id]); floatText(o.x, o.y, 'Locked out', 'muted', anim()); });
      } else {
        info.entrants.forEach((id) => {
          const t = r.act[id].shove;
          if (t && info.entrants.includes(t)) {
            any = true;
            lunge(actors[id], actors[t], anim());
            sfx(anim(), 'shove');
            const o = overHead(actors[t]);
            floatText(o.x, o.y, 'Shoved!', 'spite', anim(), 150);
          }
        });
      }
    });
    if (any) await wait(p, 650);

    // 3. doors open, traps go off
    r.doors.forEach((info) => openDoor(doors[info.index], info.trap, anim()));
    sfx(anim(), 'door');
    await wait(p, 420);
    let hurt = false, boom = false;
    r.doors.forEach((info) => {
      const door = doors[info.index];
      if (info.trap) {
        trapFx(door, info.trap, anim());
        sfx(anim(), info.trap.element, info.trap.tier !== 'minor');
        if (info.trap.tier === 'deadly') boom = true;
        if (Object.keys(info.damage || {}).length) hurt = true;
        Object.entries(info.damage || {}).forEach(([id, dmg]) => {
          const a = actors[id];
          hit(a, anim());
          const o = overHead(a);
          floatText(o.x, o.y, `−${dmg}`, 'dmg', anim(), 120);
          setHp(a, r.before[id].hp - dmg, true);
        });
      } else if (info.entrants.length) {
        floatText(door.g.cx, FLOOR - door.g.dh / 2, 'Empty', 'muted', anim(), 100);
        sfx(anim(), 'empty');
      }
      if (info.illusion !== null) {
        floatText(door.g.cx, FLOOR - door.g.dh - 10, 'Illusion!', 'spite', anim(), 300);
        if (anim()) setTimeout(() => sfx(true, 'illusion'), 300);
      }
    });
    if (boom) sfx(anim(), 'boom');
    if (hurt && anim()) setTimeout(() => sfx(true, 'hit'), 150);
    await wait(p, 1200);

    // 4. gold and rest
    r.doors.forEach((info) => {
      const door = doors[info.index];
      const from = { x: door.g.cx, y: FLOOR - door.g.dh * 0.45 };
      Object.entries(info.share || {}).forEach(([id, s]) => {
        if (r.deaths.some((x) => x.id === id) || !s) return;
        const a = actors[id];
        coins(from, { x: a.x, y: a.y - 36 }, Math.min(7, 1 + Math.ceil(s / 15)), anim());
        if (anim()) setTimeout(() => sfx(true, 'coins', Math.min(6, 1 + Math.ceil(s / 15))), 350);
        const o = overHead(a);
        floatText(o.x, o.y, `+${s}`, 'gold', anim(), 450);
      });
    });
    if (r.rests.some((x) => x.healed)) sfx(anim(), 'heal');
    r.rests.forEach((x) => {
      const a = actors[x.id];
      if (x.healed) { const o = overHead(a); floatText(o.x, o.y + 18, `+${x.healed} HP`, 'heal', anim()); }
      setHp(a, r.after[x.id].hp, true);
    });
    await wait(p, 1100);

    // 5. ghosts haunt, the dead rise
    if (r.haunts.length) {
      sfx(anim(), 'ghost');
      await Promise.all(r.haunts.map((h) => {
        const g = actors[h.ghost], t = actors[h.target];
        return moveTo(g, t.x + 30, t.y - 26, 700, 'float', anim());
      }));
      r.haunts.forEach((h) => {
        const g = actors[h.ghost], t = actors[h.target];
        if (h.stolen > 0) {
          sfx(anim(), 'steal');
          coins({ x: t.x, y: t.y - 36 }, { x: g.x, y: g.y - 40 }, 3, anim());
          floatText(t.x, t.y - 74, `−${h.stolen}`, 'spite', anim());
          floatText(g.x, g.y - 70, `+${h.stolen}`, 'ghostgold', anim(), 300);
        } else {
          floatText(g.x, g.y - 70, '…', 'muted', anim());
        }
      });
      await wait(p, 900);
    }
    if (r.deaths.length) sfx(anim(), 'death');
    r.deaths.forEach((x) => {
      const a = actors[x.id];
      a.ghost = true;
      a.sitting = false;
      drawSprite(a);
      setHp(a, 0, false);
      if (anim()) a.sprite.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 700 });
      floatText(a.x, a.y - 74, `Dropped ${x.dropped}`, 'dmg', anim(), 200);
      moveTo(a, a.x, a.y - 30, 900, 'float', anim());
    });
    if (r.deaths.length) await wait(p, 1300);
    await wait(p, 700);

    if (playing === p) playing = null;
    if (listener) listener();
  }

  /* ---------- build & refresh ---------- */
  function sceneKey(S) {
    const d = S.match && S.match.dungeon;
    if (!d) return 'none';
    if (S.phase === 'matchEnd') return `match:${W}`;
    return `${S.phase}:${S.match.dIndex}:${d.round}:${W}`;
  }

  function build(S, ui) {
    if (playing) { skip(); playing = null; }
    inner.innerHTML = '';
    actors = {};
    doors = [];
    const d = S.match.dungeon;
    const colorOf = (id) => Math.max(0, S.match.dmOrder.indexOf(id));
    const nameOf = (id) => (S.players.find((p) => p.id === id) || { name: '?' }).name;

    if (S.phase === 'matchEnd') return buildMatchEnd(S, colorOf, nameOf);

    geom = computeGeom(d.doorsCount, d.advIds);
    inner.insertAdjacentHTML('beforeend', backdrop(d, S));
    doors = geom.doors.map((g, i) => createDoor(i, g));
    fx = document.createElement('div');
    fx.className = 'fx-layer';

    const r = d.lastResult;
    const inReveal = (S.phase === 'results' || S.phase === 'dungeonEnd') && r;
    d.advs.forEach((a) => {
      const alive = inReveal ? r.before[a.id].hp > 0 : a.alive;
      const pos = alive ? geom.hall[a.id] : ghostHome(a.id);
      const ac = makeActor(a.id, nameOf(a.id), colorOf(a.id), a.affinity, alive, pos);
      setHp(ac, inReveal ? r.before[a.id].hp : a.hp, alive);
    });
    inner.appendChild(fx);

    if (inReveal) {
      r.doors.forEach((info) => setDoorFace(doors[info.index], { gold: info.gold, clue: info.clue }));
      playResult(S, r, S.phase === 'dungeonEnd');
    } else {
      refresh(S, ui);
    }
  }

  function refresh(S, ui) {
    const d = S.match.dungeon;
    const role = d.role, phase = S.phase;
    const dm = inner.querySelector('.dm');
    if (dm) dm.classList.toggle('active', phase === 'dm');
    if (phase === 'results' || phase === 'dungeonEnd') return;

    doors.forEach((door, i) => {
      let face = { unknown: true }, seen = null, clickable = false, selected = false;
      if (phase === 'dm' && role === 'dm' && ui.dm && ui.dm[i]) {
        const x = ui.dm[i];
        const clue = x.illusion !== 'honest' ? x.illusion : x.tier === 'none' ? 'none' : x.element;
        face = { gold: x.gold, clue };
        seen = { trap: x.tier === 'none' ? null : { tier: x.tier, element: x.element }, illusion: x.illusion !== 'honest' };
      } else if (phase === 'adv' && d.doors) {
        face = { gold: d.doors[i].gold, clue: d.doors[i].clue };
        if (role === 'dm' && d.dm.doors) seen = { trap: d.dm.doors[i].trap, illusion: d.dm.doors[i].illusion !== null };
        if (role === 'ghost' && d.sight) seen = { trap: d.sight[i].trap, illusion: d.sight[i].illusion !== null };
        if (role === 'adv') {
          clickable = true;
          selected = ui.adv && ui.adv.door === i;
          const l = d.mine.lens.find((x) => x.door === i);
          if (l) seen = { trap: l.trap, lens: true };
        }
      }
      setDoorFace(door, face);
      setSeen(door, seen);
      setClickable(door, clickable, selected);
    });

    d.advs.forEach((a) => {
      const ac = actors[a.id];
      if (!ac) return;
      if (a.alive && ac.element !== a.affinity) { ac.element = a.affinity; drawSprite(ac); }
      setHp(ac, a.hp, a.alive);
      const showReady = (phase === 'setup' || phase === 'adv') && a.ready;
      ac.bubble.hidden = !showReady;
    });

    // your own sprite previews your choice; nobody else sees it
    if (phase === 'adv' && role === 'adv' && actors[S.me]) {
      const me = actors[S.me];
      const act = d.mine.action;
      let door = ui.adv && ui.adv.door !== null ? ui.adv.door : null;
      if (door === null && act && act.type === 'door' && !ui.adv.resting) door = act.door;
      let target;
      if (door !== null) target = doorFront(door, 0, 1, 0);
      else if ((act && act.type === 'rest') || (ui.adv && ui.adv.resting)) target = campSpot(0);
      else target = geom.hall[S.me];
      if (Math.abs(target.x - me.x) > 1 || Math.abs(target.y - me.y) > 1) {
        const dist = Math.hypot(target.x - me.x, target.y - me.y);
        moveTo(me, target.x, target.y, Math.max(350, dist * 3.2), 'walk', !reduced());
      }
    }
  }

  function buildMatchEnd(S, colorOf, nameOf) {
    const m = S.match;
    const d = m.dungeon;
    geom = computeGeom(d ? d.doorsCount : 2, m.dmOrder);
    inner.insertAdjacentHTML('beforeend', `<div class="wall"></div><div class="floor" style="top:${FLOOR}px"></div><div class="wall-base" style="top:${FLOOR - 6}px"></div><div class="vignette"></div>`);
    fx = document.createElement('div');
    fx.className = 'fx-layer';
    const sorted = [...m.dmOrder].sort((a, b) => m.totals[b] - m.totals[a]);
    const top = m.totals[sorted[0]];
    const n = sorted.length;
    const winners = sorted.filter((id) => m.totals[id] === top);
    const pile = document.createElement('div');
    pile.className = 'hoard';
    pile.style.left = W / 2 + 'px';
    pile.style.top = H - 58 + 'px';
    pile.innerHTML = Array.from({ length: 10 }, () => Sprites.icon('coin', 3)).join('');
    inner.appendChild(pile);
    // winners stand on the hoard, everyone else lines up by rank
    let left = 0, right = 0;
    sorted.forEach((id, rank) => {
      let pos;
      if (winners.includes(id)) {
        const k = winners.indexOf(id);
        pos = { x: W / 2 + (k - (winners.length - 1) / 2) * 52, y: H - 60 };
      } else {
        const side = (rank - winners.length) % 2 === 0 ? 1 : -1;
        const slot = side === 1 ? ++right : ++left;
        pos = { x: W / 2 + side * (60 + slot * Math.min(90, (W / 2 - 80) / Math.max(1, Math.ceil((n - 1) / 2)))), y: H - 30 };
      }
      const place = 1 + sorted.filter((x) => m.totals[x] > m.totals[id]).length;
      const a = makeActor(id, `${place}. ${nameOf(id)}`, colorOf(id), null, true, pos);
      a.hp.hidden = true;
      if (winners.includes(id)) {
        const c = document.createElement('div');
        c.className = 'crown';
        c.innerHTML = Sprites.icon('crown', 4);
        a.body.appendChild(c);
      }
    });
    inner.appendChild(fx);
    if (!reduced()) {
      sfx(true, 'fanfare');
      for (let k = 0; k < 26; k++) {
        const el = document.createElement('div');
        el.className = 'flycoin';
        el.innerHTML = Sprites.icon('coin', 2);
        el.style.left = W / 2 + rnd(-140, 140) + 'px';
        el.style.top = '-20px';
        fx.appendChild(el);
        el.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${H - 40}px)`, opacity: 0.2 }], { duration: rnd(900, 1500), delay: rnd(0, 1600), easing: 'ease-in', fill: 'both' }).finished.then(() => el.remove());
      }
    }
  }

  function update(S, ui) {
    last = { S, ui };
    if (!root || !S.match || !S.match.dungeon) return;
    const k = sceneKey(S);
    if (k !== key) {
      key = k;
      build(S, ui);
    } else {
      refresh(S, ui);
    }
  }

  function replay() {
    if (!last) return;
    key = null;
    update(last.S, last.ui);
  }

  return {
    mount, update, skip, replay,
    isPlaying: () => !!playing,
    onChange: (fn) => { listener = fn; },
  };
})();
