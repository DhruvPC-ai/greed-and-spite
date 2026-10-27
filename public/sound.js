'use strict';
/* Every sound is synthesized with Web Audio, so there are no audio files to host. */
const Sound = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('gs_muted') === '1'; } catch (e) { /* private mode */ }

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }
  // browsers only allow audio after the player has clicked something
  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));

  function tone({ type = 'sine', f0, f1 = f0, dur = 0.15, vol = 0.25, delay = 0, attack = 0.005 }) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function noise({ dur = 0.3, vol = 0.2, type = 'lowpass', f0 = 1000, f1 = f0, q = 1, delay = 0, attack = 0.005 }) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  const FX = {
    click: () => tone({ type: 'square', f0: 660, dur: 0.05, vol: 0.06 }),
    tick: () => tone({ type: 'square', f0: 1200, dur: 0.04, vol: 0.08 }),
    yourTurn: () => { tone({ type: 'triangle', f0: 523, dur: 0.18, vol: 0.18 }); tone({ type: 'triangle', f0: 784, dur: 0.3, vol: 0.18, delay: 0.12 }); },
    lockIn: () => { tone({ type: 'square', f0: 392, dur: 0.07, vol: 0.08 }); tone({ type: 'square', f0: 587, dur: 0.1, vol: 0.08, delay: 0.06 }); },
    march: (n = 6, gap = 0.16) => { for (let i = 0; i < n; i++) noise({ dur: 0.07, vol: 0.12, type: 'lowpass', f0: 500, delay: i * gap }); },
    door: () => {
      tone({ type: 'sawtooth', f0: 140, f1: 90, dur: 0.55, vol: 0.05, attack: 0.08 });
      noise({ dur: 0.5, vol: 0.06, type: 'bandpass', f0: 900, f1: 400, q: 8, attack: 0.1 });
      noise({ dur: 0.12, vol: 0.2, type: 'lowpass', f0: 200, delay: 0.45 });
    },
    lock: () => { noise({ dur: 0.08, vol: 0.3, type: 'highpass', f0: 2000 }); tone({ type: 'square', f0: 110, dur: 0.15, vol: 0.12, delay: 0.03 }); },
    shove: () => { noise({ dur: 0.18, vol: 0.25, type: 'lowpass', f0: 700, f1: 150 }); tone({ type: 'sine', f0: 180, f1: 70, dur: 0.2, vol: 0.2 }); },
    fire: (big) => {
      noise({ dur: big ? 1.1 : 0.8, vol: big ? 0.38 : 0.28, type: 'lowpass', f0: 300, f1: 3000, attack: 0.05 });
      for (let i = 0; i < 7; i++) noise({ dur: 0.03, vol: 0.18, type: 'highpass', f0: 3000, delay: 0.1 + i * 0.09 });
    },
    water: (big) => {
      noise({ dur: big ? 0.9 : 0.6, vol: big ? 0.35 : 0.26, type: 'bandpass', f0: 2500, f1: 400, q: 1.5 });
      for (let i = 0; i < 5; i++) tone({ type: 'sine', f0: 500 + i * 140, f1: 1100 + i * 160, dur: 0.07, vol: 0.08, delay: 0.15 + i * 0.08 });
    },
    earth: (big) => {
      tone({ type: 'sine', f0: 90, f1: 35, dur: big ? 0.9 : 0.6, vol: 0.45 });
      noise({ dur: big ? 1.0 : 0.7, vol: 0.28, type: 'lowpass', f0: 400, f1: 120 });
      for (let i = 0; i < 4; i++) noise({ dur: 0.08, vol: 0.2, type: 'lowpass', f0: 900, delay: 0.2 + i * 0.13 });
    },
    air: (big) => {
      noise({ dur: big ? 1.0 : 0.7, vol: big ? 0.32 : 0.24, type: 'bandpass', f0: 400, f1: 2400, q: 3, attack: 0.15 });
      noise({ dur: 0.6, vol: 0.12, type: 'bandpass', f0: 1800, f1: 600, q: 4, delay: 0.25, attack: 0.1 });
    },
    boom: () => { tone({ type: 'sine', f0: 70, f1: 30, dur: 0.9, vol: 0.5 }); noise({ dur: 0.6, vol: 0.3, type: 'lowpass', f0: 250 }); },
    hit: () => { tone({ type: 'square', f0: 330, f1: 110, dur: 0.18, vol: 0.12 }); },
    empty: () => { tone({ type: 'triangle', f0: 300, f1: 260, dur: 0.25, vol: 0.06 }); },
    illusion: () => { for (let i = 0; i < 4; i++) tone({ type: 'sine', f0: 1400 - i * 180, dur: 0.12, vol: 0.06, delay: i * 0.06 }); },
    coins: (n = 3) => { for (let i = 0; i < Math.min(n, 6); i++) { tone({ type: 'square', f0: 1318, dur: 0.05, vol: 0.06, delay: i * 0.07 }); tone({ type: 'square', f0: 1760, dur: 0.08, vol: 0.06, delay: i * 0.07 + 0.04 }); } },
    heal: () => { [523, 659, 784].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.16, vol: 0.12, delay: i * 0.08 })); },
    ghost: () => { tone({ type: 'sine', f0: 400, f1: 800, dur: 0.6, vol: 0.1, attack: 0.15 }); tone({ type: 'sine', f0: 403, f1: 760, dur: 0.6, vol: 0.08, attack: 0.15 }); },
    steal: () => { tone({ type: 'sine', f0: 900, f1: 300, dur: 0.35, vol: 0.12 }); FX.coins(2); },
    death: () => { [392, 349, 311, 262].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.25, vol: 0.15, delay: i * 0.16 })); tone({ type: 'sine', f0: 300, f1: 900, dur: 1.0, vol: 0.07, delay: 0.7, attack: 0.3 }); },
    drumroll: (len = 0.8) => {
      const n = Math.round(len * 18);
      let t = 0;
      for (let i = 0; i < n; i++) {
        noise({ dur: 0.05, vol: 0.05 + (i / n) * 0.1, type: 'bandpass', f0: 220, q: 2, delay: t });
        t += Math.max(0.03, 0.08 - i * 0.004);
      }
    },
    pop: () => tone({ type: 'triangle', f0: 880, f1: 1320, dur: 0.08, vol: 0.07 }),
    whisper: () => noise({ dur: 0.35, vol: 0.06, type: 'bandpass', f0: 3000, f1: 1800, q: 3, attack: 0.08 }),
    place: () => { tone({ type: 'square', f0: 160, f1: 90, dur: 0.12, vol: 0.12 }); noise({ dur: 0.08, vol: 0.12, type: 'lowpass', f0: 600 }); },
    fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', f0: f, dur: i === 3 ? 0.6 : 0.16, vol: 0.09, delay: i * 0.14 })); FX.coins(6); },
  };

  function play(name, ...args) {
    if (muted || !FX[name]) return;
    const c = ensure();
    if (!c || c.state !== 'running') return;
    try { FX[name](...args); } catch (e) { /* never let a sound break the game */ }
  }
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('gs_muted', muted ? '1' : '0'); } catch (e) { /* private mode */ }
  }
  return { play, unlock, setMuted, isMuted: () => muted };
})();
