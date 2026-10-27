'use strict';
/* A short, visual tutorial: one small picture and one or two sentences per slide. */
const Tutorial = (() => {
  let open = false;
  let index = 0;
  let onFinish = null;

  const I = (name, scale = 3) => Sprites.icon(name, scale);
  const adv = (color, el, scale = 3) => `<span class="t-sprite">${Sprites.adventurer(color, el, scale)}</span>`;
  const door = ({ gold, clue, label, warn, trap, open: isOpen, num = 'I' }) => `
    <div class="tdoor-wrap">
      ${gold !== undefined ? `<div class="tplaque">${I('coin', 2)}<b>${gold}</b></div>` : ''}
      <div class="tdoor ${isOpen ? 'open' : ''}">
        ${isOpen ? `<div class="tdoor-inside">${trap ? I(trap, 4) : ''}</div>` : `
          <span class="tdoor-num">${num}</span>
          ${label ? `<span class="tdoor-clue el-${clue}">${label}</span>` : ''}
          ${warn ? `<span class="twarn ${warn}">${warn === 'weak' ? 'Weak' : 'Resist'}</span>` : ''}`}
      </div>
    </div>`;
  const tag = (text, cls = '') => `<span class="ttag ${cls}">${text}</span>`;

  const SLIDES = [
    {
      key: 'welcome',
      title: 'Grab the gold. Trust no one.',
      text: 'One player is the Dungeon Master and hides gold behind trapped doors. Everyone else grabs what they can. Each player is DM once, and the most gold wins.',
      art: () => `
        <div class="tcol">
          <div class="t-dm">${Sprites.dmHood(4)}<span>The DM</span></div>
          <div class="trow">${adv(1, 'water')}${I('coin', 3)}${adv(2, 'air')}${I('coin', 3)}${adv(3, 'earth')}</div>
          <div class="tcaption">The adventurers, each out for themselves</div>
        </div>`,
    },
    {
      key: 'doors',
      title: 'Pick a door',
      text: 'Each door shows its gold and a clue. A trapped door gives away its trap’s element. A silent door looks safe, but the DM can pay for an illusion to fake any clue.',
      art: () => `
        <div class="trow end">
          ${door({ gold: 30, clue: 'fire', label: 'Smoke', num: 'I' })}
          <div class="tcol tight">${tag(`${I('fire', 2)} Smoke = Fire trap`)}${tag(`${I('water', 2)} Dripping = Water trap`)}${tag(`${I('earth', 2)} Rumbling = Earth trap`)}${tag(`${I('air', 2)} Draft = Air trap`)}${tag('Silent = no trap?', 'muted')}</div>
          ${door({ gold: 15, clue: 'none', label: 'Silent', num: 'II' })}
        </div>`,
    },
    {
      key: 'speed',
      title: 'Choose how you go in',
      text: 'Sprint grabs the most gold but gets hurt the most. Sneak is safe but grabs little. Walk is in between.',
      art: () => `
        <div class="tcol tight left">
          ${[['Sprint', 3, '×1.5 damage', 'run'], ['Walk', 2, '×1 damage', ''], ['Sneak', 1, '×0.5 damage', 'sneak']].map(([n, bags, dmg, cls], k) => `
            <div class="tline">
              <span class="tpose ${cls}">${Sprites.adventurer(k + 1, null, 3)}</span>
              <b class="tname">${n}</b>
              <span class="tbags">${I('bag', 3).repeat(bags)}</span>
              <span class="tdmg">${dmg}</span>
            </div>`).join('')}
          <div class="tcaption">Bags show how much of the room’s gold you can carry</div>
        </div>`,
    },
    {
      key: 'first',
      title: 'The first ones in spring the trap',
      text: 'Only the fastest players into a room get hurt. Anyone slower behind them is safe and still grabs a share. Let someone else go first.',
      art: () => `
        <div class="trow end">
          ${door({ open: true, trap: 'fire' })}
          <div class="tcol tight">
            <div class="tline">${adv(1, 'water', 3)}<span class="tfloat dmg">−30</span><span class="tnote">Sprinted in first</span></div>
            <div class="tline">${adv(3, 'earth', 3)}<span class="tfloat gold">+6</span><span class="tnote">Sneaked in behind. Safe!</span></div>
          </div>
        </div>`,
    },
    {
      key: 'elements',
      title: 'Elements',
      text: 'Each element beats the next one around the circle. You resist your own element and are weak to the one that beats it. Doors warn you, so you don’t need to memorise this.',
      art: () => `
        <div class="trow end">
          <div class="twheel">
            <span class="w-n">${I('water', 4)}<i>Water</i></span>
            <span class="w-e">${I('fire', 4)}<i>Fire</i></span>
            <span class="w-s">${I('air', 4)}<i>Air</i></span>
            <span class="w-w">${I('earth', 4)}<i>Earth</i></span>
            <span class="w-arrow a1">➜</span><span class="w-arrow a2">➜</span><span class="w-arrow a3">➜</span><span class="w-arrow a4">➜</span>
          </div>
          <div class="tcol tight">
            ${door({ gold: 25, clue: 'fire', label: 'Smoke', warn: 'weak' })}
            <div class="tcaption">You’re Air, so a Fire door warns you</div>
          </div>
        </div>`,
    },
    {
      key: 'shop',
      title: 'Rest, shop and items',
      text: 'Resting by the fire heals you. The shop is open while you wait and while you choose. Items are single use, and gold you spend no longer counts toward your score.',
      art: () => `
        <div class="trow end">
          <div class="tcol tight"><div class="tfire">${Sprites.flame(4)}<div class="tlogs"></div></div><span class="tt-sit">${Sprites.sitting(2, 'air', 3)}</span><span class="tfloat heal">+10 HP</span></div>
          <div class="titems">
            ${[['potion', 'Potion', 'Heal 40'], ['shield', 'Armour', 'Half damage'], ['amulet', 'Charm', 'Resist an element'], ['eye', 'Lens', 'See one trap'], ['lock', 'Lock', 'Take all, lock others out'], ['push', 'Shove', 'Push someone in first']].map(([ic, n, d]) => `
              <div class="titem">${I(ic, 3)}<b>${n}</b><span>${d}</span></div>`).join('')}
          </div>
        </div>`,
    },
    {
      key: 'ghosts',
      title: 'Dying isn’t the end',
      text: 'At 0 HP you drop half your gold and become a ghost. Ghosts see every trap. Haunt someone, and if a trap hurts them, you steal a quarter of their gold.',
      art: () => `
        <div class="trow end">
          ${adv(4, 'fire', 3)}
          <span class="tarrow">➜</span>
          <span class="t-sprite ghosty">${Sprites.ghost(4, 3)}</span>
          <span class="tfloat ghostgold">+12 ${I('coin', 2)}</span>
          <div class="tcol tight">${tag('Sees every real trap')}${tag('Can talk, and can lie', 'spite')}</div>
        </div>`,
    },
    {
      key: 'dm',
      title: 'When you’re the DM',
      text: 'Split your gold between the doors and spend mana on traps. Mana is your trap budget: you get more every round, and what you don’t spend carries over. Gold nobody takes is yours, so big gold makes great bait.',
      art: () => `
        <div class="trow end">
          <div class="tcol tight">
            <div class="tmana">${I('mana', 4)}<b>18 mana</b><span>this round</span></div>
            ${tag(`Minor trap: 8`)}${tag(`Major trap: 14`)}${tag(`Deadly trap: 20`)}${tag(`Fake clue: 6`, 'spite')}
          </div>
          ${door({ gold: 70, clue: 'none', label: 'Silent', num: 'II' })}
          <div class="tcol tight">${tag('Big gold, no clue…', 'gold')}${tag('Trap or bluff?', 'muted')}</div>
        </div>`,
    },
  ];

  function keyIndex(key) {
    const k = SLIDES.findIndex((s) => s.key === key);
    return k < 0 ? 0 : k;
  }
  function show(start, finish) {
    open = true;
    index = typeof start === 'string' ? keyIndex(start) : start || 0;
    onFinish = finish || null;
  }
  function close(done) {
    open = false;
    if (done && onFinish) onFinish();
    onFinish = null;
  }
  function html() {
    const s = SLIDES[index];
    const last = index === SLIDES.length - 1;
    const dots = SLIDES.map((_, k) => `<button class="tdot ${k === index ? 'on' : ''}" data-act="tutGo" data-i="${k}" aria-label="Slide ${k + 1}" ${k === index ? 'aria-current="step"' : ''}></button>`).join('');
    return `<div class="modal" data-act="tutClose"><div class="win tut" role="dialog" aria-label="How to play" data-stop="1">
      <div class="trow spread">
        <span class="muted small">How to play, ${index + 1} of ${SLIDES.length}</span>
        <button class="pbtn sm quiet" data-act="tutClose">${last ? 'Close' : 'Skip'}</button>
      </div>
      <div class="tart">${s.art()}</div>
      <h2 class="ttitle">${s.title}</h2>
      <p class="ttext">${s.text}</p>
      <div class="trow spread tnav">
        <button class="pbtn" data-act="tutPrev" ${index === 0 ? 'disabled' : ''}>Back</button>
        <div class="tdots">${dots}</div>
        <button class="pbtn gold" data-act="${last ? 'tutDone' : 'tutNext'}">${last ? 'Let’s play' : 'Next'}</button>
      </div>
      ${last ? '<p class="small muted" style="margin:12px 0 0;text-align:center"><button class="linkish" data-act="rules">Read the full rules</button></p>' : ''}
    </div></div>`;
  }
  function handle(act, i) {
    if (act === 'tutNext') index = Math.min(SLIDES.length - 1, index + 1);
    else if (act === 'tutPrev') index = Math.max(0, index - 1);
    else if (act === 'tutGo') index = i;
    else if (act === 'tutClose') close(false);
    else if (act === 'tutDone') close(true);
  }
  return { show, close, html, handle, isOpen: () => open, count: SLIDES.length };
})();
