'use strict';
/* The lantern close-up: the door turns see-through and shows what lies beyond it.
   It opens over part of the room, so you can still watch everyone else. */
const ScanView = (() => {
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  const NAMES = { fire: 'Fire', water: 'Water', earth: 'Earth', air: 'Air', none: 'Silent' };
  const BEYOND = {
    fire: 'Heat and embers beyond the door.',
    water: 'Water seeping and dripping beyond the door.',
    earth: 'Loose rock and dust beyond the door.',
    air: 'A cold wind howling beyond the door.',
    none: 'Silence. A dark, empty corridor.',
  };
  const TIER = { minor: 'Minor', major: 'Major', deadly: 'Deadly' };
  let el = null, state = null, timers = [];
  const still = () => !!(window.GSAnimOff && window.GSAnimOff());
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));

  function caption(text) {
    const c = el && el.querySelector('.sv-caption');
    if (c) c.textContent = text;
  }
  function particles() { return '<i></i>'.repeat(8); }

  function show(door, ms, lens) {
    close();
    const host = document.querySelector('.room');
    if (!host) return;
    state = { door, ms, lens };
    el = document.createElement('div');
    el.className = 'scanview' + (still() ? ' still' : '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `Scanning door ${ROMAN[door]}`);
    el.innerHTML = `
      <div class="sv-window">
        <div class="sv-beyond sv-mist">${particles()}</div>
        <div class="sv-door"><span class="sv-num">${ROMAN[door]}</span><span class="sv-band b1"></span><span class="sv-band b2"></span><span class="sv-ring"></span></div>
        <div class="sv-light"></div>
        <div class="sv-shards"></div>
        <div class="sv-rune" hidden></div>
        <div class="sv-lantern">${Sprites.lantern(5)}</div>
        <div class="sv-bar"><i style="animation-duration:${ms}ms"></i></div>
      </div>
      <p class="sv-caption" aria-live="polite">${lens ? 'Fitting the Lens and raising your lantern…' : 'Raising your lantern…'}</p>
      <button class="pbtn sm sv-stop" data-act="scanStop">Stop (you get the oil back)</button>`;
    host.appendChild(el);
    requestAnimationFrame(() => el && el.classList.add('go'));
    later(Math.min(800, ms * 0.3), () => caption(`Door ${ROMAN[door]} is turning see-through…`));
  }

  function showBeyond(element, label) {
    const b = el.querySelector('.sv-beyond');
    b.className = 'sv-beyond sv-' + element;
    b.innerHTML = particles();
    const r = el.querySelector('.sv-rune');
    r.hidden = false;
    r.className = 'sv-rune el-' + element;
    r.innerHTML = `${Sprites.icon(element, 7)}<b>${label}</b>`;
    r.classList.remove('pop');
    void r.offsetWidth;
    r.classList.add('pop');
  }

  // res: { clue, lens: { trap, illusion } | null }
  function reveal(res) {
    if (!el) return;
    timers.forEach(clearTimeout);
    timers = [];
    el.querySelector('.sv-bar').hidden = true;
    el.querySelector('.sv-stop').hidden = true;
    el.classList.add('done');
    const clue = res.clue;
    if (!state.lens || !res.lens) {
      showBeyond(clue, NAMES[clue]);
      caption(clue === 'none' ? 'Silent: no clue at all. (The DM can fake that too.)' : `${NAMES[clue]}: ${BEYOND[clue]} Clues can be faked.`);
      Sound.play('rune');
      later(1900, close);
      return;
    }
    const real = res.lens.trap;
    const realEl = real ? real.element : 'none';
    const realLabel = real ? `${TIER[real.tier]} ${NAMES[realEl]}` : 'No trap';
    if (res.lens.illusion) {
      showBeyond(clue, NAMES[clue]);
      caption(`It looks like ${NAMES[clue]}… but your Lens shows a lie.`);
      Sound.play('rune');
      later(still() ? 500 : 1100, () => {
        if (!el) return;
        el.classList.add('shatter');
        Sound.play('shatter');
        shards();
        later(still() ? 0 : 450, () => {
          if (!el) return;
          showBeyond(realEl, realLabel);
          caption(real ? `The illusion shatters! A ${realLabel} trap.` : 'The illusion shatters! There is no trap.');
        });
        later(still() ? 2000 : 2600, close);
      });
    } else {
      showBeyond(realEl, realLabel);
      caption(real ? `Your Lens confirms it: a ${realLabel} trap.` : 'Your Lens confirms it: no trap.');
      Sound.play('rune');
      later(2200, close);
    }
  }

  function shards() {
    if (still() || !el) return;
    const box = el.querySelector('.sv-shards');
    box.innerHTML = '';
    for (let k = 0; k < 12; k++) {
      const s = document.createElement('i');
      const ang = (k / 12) * Math.PI * 2;
      s.style.setProperty('--dx', Math.cos(ang) * (80 + Math.random() * 60) + 'px');
      s.style.setProperty('--dy', Math.sin(ang) * (80 + Math.random() * 60) + 'px');
      s.style.setProperty('--r', Math.round(Math.random() * 360) + 'deg');
      box.appendChild(s);
    }
  }

  function cancel(reason) {
    if (!el) return;
    timers.forEach(clearTimeout);
    timers = [];
    el.querySelector('.sv-bar').hidden = true;
    el.querySelector('.sv-stop').hidden = true;
    caption(reason === 'moved' ? 'You walked away, so the scan stopped. Your oil is back.' : reason === 'time' ? 'Out of time. Your oil is back.' : 'Scan stopped. Your oil is back.');
    later(1100, close);
  }

  function close() {
    timers.forEach(clearTimeout);
    timers = [];
    if (el) el.remove();
    el = null;
    state = null;
  }

  return { show, reveal, cancel, close, isOpen: () => !!el };
})();
