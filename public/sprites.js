'use strict';
/* Original pixel art for Greed & Spite. Every sprite is a pixel map turned into an SVG. */
const Sprites = (() => {
  const CLOAKS = ['#c4413a', '#2b9e8f', '#8e5ccc', '#d98a2b', '#4c9a4f', '#4a6fd6'];
  const ELEMENT = { fire: '#ef6c3f', water: '#55a6ec', earth: '#c19555', air: '#8ad8c6' };

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // turn a pixel map into an SVG, merging runs of the same colour into one rect
  function pix(map, pal, scale, cls) {
    const h = map.length, w = map[0].length;
    let rects = '';
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const ch = map[y][x];
        if (ch === '.' || !pal[ch]) { x++; continue; }
        let x2 = x;
        while (x2 < w && map[y][x2] === ch) x2++;
        rects += `<rect x="${x}" y="${y}" width="${x2 - x}" height="1" fill="${pal[ch]}"/>`;
        x = x2;
      }
    }
    return `<svg class="${cls || ''}" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }

  const BODY_TOP = [
    '....HHHH....',
    '...HHHHHH...',
    '..HHHHHHHH..',
    '..HHSSSSHH..',
    '..HSKSSKSH..',
    '..HSSSSSSH..',
    '...HSSSSH...',
    '..CCCCCCCC..',
    '.CCCCEECCCC.',
    '.SCCEEEECCS.',
    '.SCCCEECCCS.',
    '..BBBBBBBB..',
    '..CCCCCCCC..',
  ];
  const LEGS_A = ['..LLL..LLL..', '..LLL..LLL..', '.KKKK..KKKK.'];
  const LEGS_B = ['...LLLLL....', '..LL...LLL..', '.KKK.....KKK'];
  const LEGS_SIT = ['.LLLLLLLLLL.', '.KKKK..KKKK.', '............'];

  function advPalette(colorIdx, element) {
    const cloak = CLOAKS[colorIdx % CLOAKS.length];
    return {
      H: shade(cloak, -0.12), C: cloak, E: element ? ELEMENT[element] : shade(cloak, 0.18),
      S: '#f0c8a0', K: '#1d1620', B: '#6b4423', L: '#3d3550',
    };
  }

  // top-down views for the room: back and side (the side view faces right; left is mirrored)
  const BACK_TOP = [
    '....HHHH....',
    '...HHHHHH...',
    '..HHHHHHHH..',
    '..HHHHHHHH..',
    '..HHHHHHHH..',
    '..HHHHHHHH..',
    '...HHHHHH...',
    '..CCCCCCCC..',
    '.CCCCCCCCCC.',
    '.SCCCCCCCCS.',
    '.SCCCCCCCCS.',
    '..BBBBBBBB..',
    '..CCCCCCCC..',
  ];
  const SIDE_TOP = [
    '....HHHH....',
    '...HHHHHH...',
    '..HHHHHHHH..',
    '..HHHHHSSH..',
    '..HHHHSSKS..',
    '..HHHHSSSS..',
    '...HHHHSS...',
    '...CCCCCC...',
    '...CCCCECC..',
    '...CCSSCCC..',
    '...CCSSCCC..',
    '...BBBBBB...',
    '...CCCCCC...',
  ];
  const SIDE_LEGS_A = ['...LL..LL...', '..LL....LL..', '.KKK....KKK.'];
  const SIDE_LEGS_B = ['....LLLL....', '....LLLL....', '....KKKK....'];
  function walker(colorIdx, element, dir, scale = 3) {
    const pal = advPalette(colorIdx, element);
    if (dir === 'up') return pix(BACK_TOP.concat(LEGS_A), pal, scale, 'f1') + pix(BACK_TOP.concat(LEGS_B), pal, scale, 'f2');
    if (dir === 'left' || dir === 'right') return pix(SIDE_TOP.concat(SIDE_LEGS_A), pal, scale, 'f1') + pix(SIDE_TOP.concat(SIDE_LEGS_B), pal, scale, 'f2');
    return pix(BODY_TOP.concat(LEGS_A), pal, scale, 'f1') + pix(BODY_TOP.concat(LEGS_B), pal, scale, 'f2');
  }

  // two walk frames stacked; CSS swaps them
  function adventurer(colorIdx, element, scale = 4) {
    const pal = advPalette(colorIdx, element);
    return pix(BODY_TOP.concat(LEGS_A), pal, scale, 'f1') + pix(BODY_TOP.concat(LEGS_B), pal, scale, 'f2');
  }
  function sitting(colorIdx, element, scale = 4) {
    const pal = advPalette(colorIdx, element);
    return pix(BODY_TOP.concat(LEGS_SIT), pal, scale, 'f1');
  }
  function portrait(colorIdx, element, scale = 3) {
    return pix(BODY_TOP.slice(0, 11), advPalette(colorIdx, element), scale, '');
  }

  const GHOST_A = [
    '....WWWW....',
    '..WWWWWWWW..',
    '.WWWWWWWWWW.',
    '.WWKKWWKKWW.',
    '.WWKKWWKKWW.',
    'WWWWWWWWWWWW',
    'WWWWWMMWWWWW',
    'WWWWWMMWWWWW',
    'WWWWWWWWWWWW',
    'WWWWWWWWWWWW',
    'WCWWWWWWWWCW',
    'WWWWWWWWWWWW',
    'WWW.WWWW.WWW',
    'WW...WW...WW',
    '............',
    '............',
  ];
  const GHOST_B = GHOST_A.slice(0, 12).concat(['.WWW.WW.WWW.', '..W..WW..W..', '............', '............']);
  function ghost(colorIdx, scale = 4) {
    const pal = { W: '#e6e0ff', K: '#3b2f6b', M: '#3b2f6b', C: CLOAKS[colorIdx % CLOAKS.length] };
    return pix(GHOST_A, pal, scale, 'f1') + pix(GHOST_B, pal, scale, 'f2');
  }

  const MERCHANT = [
    '....HHHH....',
    '...HHHHHH...',
    '.HHHHHHHHHH.',
    '...SSSSSS...',
    '...SKSSKS...',
    '...SSSSSS...',
    '...SWWWWS...',
    '..BBWWWWBB..',
    'PPPCCCCCCPPP',
    'PPPCCYYCCPPP',
    'PPPCCCCCCPPP',
    'PPP.CCCC.PPP',
    '....LL.LL...',
    '....LL.LL...',
    '...KKK.KKK..',
    '............',
  ];
  function merchant(scale = 4) {
    return pix(MERCHANT, { H: '#6b3f8f', S: '#f0c8a0', K: '#1d1620', W: '#e8e2d0', B: '#5a3d1e', C: '#4a7a5a', P: '#8a5a2b', Y: '#f5c542', L: '#3d3550' }, scale, '');
  }

  const HOOD = [
    '........KKKKKKKK........',
    '......KKKKKKKKKKKK......',
    '....KKKKKKKKKKKKKKKK....',
    '...KKKKDDDDDDDDDDKKKK...',
    '..KKKKDDDDDDDDDDDDKKKK..',
    '..KKKDDDEEDDDDEEDDDKKK..',
    '.KKKKDDDEEDDDDEEDDDKKKK.',
    '.KKKKDDDDDDDDDDDDDDKKKK.',
    'KKKKKKDDDDDDDDDDDDKKKKKK',
    'KKKKKKKKDDDDDDDDKKKKKKKK',
  ];
  function dmHood(scale = 5) {
    return pix(HOOD, { K: '#151520', D: '#07070c', E: '#ff5f4a' }, scale, '');
  }

  const ICONS = {
    fire: [['...R....', '..RR..R.', '..RYR.R.', '.RRYYRR.', '.RYYYYR.', 'RYYWWYYR', 'RYYWWYYR', '.RRRRRR.'], { R: '#e8552b', Y: '#f5a623', W: '#fff1a8' }],
    water: [['...BB...', '...BB...', '..BBBB..', '.BBLBBB.', '.BLBBBB.', 'BBLBBBBB', '.BBBBBB.', '..BBBB..'], { B: '#3d8ee0', L: '#bfe3ff' }],
    earth: [['........', '..RRRR..', '.RRDRRR.', 'RRRRRDRR', 'RDRRRRRR', 'RRRRDRRR', '.RRRRRR.', '........'], { R: '#b0864b', D: '#6b4c27' }],
    air: [['........', 'AAAAA...', '.....A..', 'AAAAAA.A', '.......A', '.AAAAAA.', '........', '..AAA...'], { A: '#8ad8c6' }],
    coin: [['..GGGG..', '.GYYYYG.', 'GYYWYYYG', 'GYWYYYYG', 'GYYYYYYG', 'GYYYYYYG', '.GYYYYG.', '..GGGG..'], { G: '#a8761c', Y: '#f5c542', W: '#fff4c2' }],
    lock: [['..KKKK..', '.K....K.', '.K....K.', 'BBBBBBBB', 'BYYYYYYB', 'BYYKKYYB', 'BYYKKYYB', 'BBBBBBBB'], { K: '#9aa3b5', B: '#7a5a1c', Y: '#e0b44a' }],
    skull: [['..WWWW..', '.WWWWWW.', 'WWKWWKWW', 'WWKWWKWW', 'WWWWWWWW', '.WWKKWW.', '..WWWW..', '..W.W.W.'], { W: '#efe6cf', K: '#1d1620' }],
    heart: [['........', '.RR..RR.', 'RRRRRRRR', 'RRRRRRRR', '.RRRRRR.', '..RRRR..', '...RR...', '........'], { R: '#e0524a' }],
    crown: [['Y..Y..Y.', 'YY.YY.YY', 'YYYYYYYY', 'YRYYGYRY', 'YYYYYYYY', '........', '........', '........'], { Y: '#f5c542', R: '#e0524a', G: '#4c9a4f' }],
    mana: [['...MM...', '..MMMM..', '.MMWMMM.', 'MMWMMMMM', 'MMMMMMMM', '.MMMMMM.', '..MMMM..', '...MM...'], { M: '#8f7bff', W: '#e3dcff' }],
    hourglass: [['KKKKKKKK', '.KYYYYK.', '..KYYK..', '...KK...', '...KK...', '..K..K..', '.KYYYYK.', 'KKKKKKKK'], { K: '#c9a35a', Y: '#f5c542' }],
    none: [['........', '..WWWW..', '.W....W.', '.....W..', '....W...', '........', '....W...', '........'], { W: '#a9a48f' }],
    shield: [['KKKKKKKK', 'KSSSSSSK', 'KSWSSSSK', 'KSWSSSSK', 'KSSSSSSK', '.KSSSSK.', '..KSSK..', '...KK...'], { S: '#9aa3b5', W: '#e3e8f2', K: '#3a3f55' }],
    eye: [['........', '..KKKK..', '.KWWWWK.', 'KWWBBWWK', 'KWWBBWWK', '.KWWWWK.', '..KKKK..', '........'], { K: '#c9a35a', W: '#e8f4ff', B: '#1d1620' }],
    push: [['........', '....A...', '....AA..', 'AAAAAAA.', 'AAAAAAAA', 'AAAAAAA.', '....AA..', '....A...'], { A: '#ff8fb1' }],
    amulet: [['..K..K..', '...KK...', '...KK...', '..PPPP..', '.PPWPPP.', '.PPPPPP.', '..PPPP..', '...PP...'], { K: '#c9a35a', P: '#8f7bff', W: '#e3dcff' }],
    potion: [['...KK...', '...WW...', '...WW...', '..WRRW..', '.WRRRRW.', '.WRWRRW.', '.WRRRRW.', '..WWWW..'], { K: '#6b4423', W: '#cfd8e6', R: '#e0524a' }],
    bag: [['...KK...', '..K..K..', '...KK...', '..GGGG..', '.GGYYGG.', 'GGYGGYGG', 'GGGGGGGG', '.GGGGGG.'], { K: '#5a3d1e', G: '#9b7440', Y: '#f5c542' }],
    pointer: [['..WWWW..', '..WWWW..', '..WWWW..', 'WWWWWWWW', '.WWWWWW.', '..WWWW..', '...WW...', '........'], { W: '#f2c14e' }],
    flask: [['...KK...', '...WW...', '..WOOW..', '.WOOOOW.', '.WOYYOW.', '.WOOOOW.', '..WWWW..', '........'], { W: '#cfd8e6', O: '#d98a2b', Y: '#f5c542', K: '#6b4423' }],
    book: [['.KKKKKKK', 'KBBBBBBK', 'KBYYBBBK', 'KBBBBBBK', 'KBBBBYBK', 'KBBBBBBK', 'KWWWWWWK', '.KKKKKKK'], { B: '#7a3b2a', Y: '#e0b44a', W: '#efe6cf', K: '#2a160f' }],
    bubble: [['.WWWWWW.', 'WWWWWWWW', 'WWKWKWKW', 'WWWWWWWW', '.WWWWWW.', '..WW....', '.W......', '........'], { W: '#efe6cf', K: '#1d1620' }],
    scroll: [['BB.....B', 'BPPPPPPB', '.PKKKKP.', '.PPPPPP.', '.PKKKP..', '.PPPPPP.', 'BPPPPPPB', 'B.....BB'], { P: '#e9d7a8', K: '#7a6a4a', B: '#9b7440' }],
    gear: [['...GG...', '.G.GG.G.', '..GGGG..', 'GGG..GGG', 'GGG..GGG', '..GGGG..', '.G.GG.G.', '...GG...'], { G: '#a8b0c4' }],
    spikes: [['..W...W.', '..W...W.', '.WGW.WGW', '.WGW.WGW', 'WGGGWGGG', 'WGGGWGGG', 'KKKKKKKK', 'KKKKKKKK'], { W: '#e3e8f2', G: '#9aa3b5', K: '#4a3418' }],
    erase: [['R......R', '.R....R.', '..R..R..', '...RR...', '...RR...', '..R..R..', '.R....R.', 'R......R'], { R: '#e0524a' }],
    zz: [['ZZZZ....', '..Z.....', '.Z......', 'ZZZZ.ZZZ', '......Z.', '.....ZZZ', '........', '........'], { Z: '#c3b6ff' }],
  };
  function icon(name, scale = 3) {
    const [map, pal] = ICONS[name] || ICONS.none;
    return pix(map, pal, scale, 'icon');
  }

  // the lantern held up in the scan close-up: a hand on the handle, glowing glass below
  const LANTERN = [
    '....SSS.....',
    '...SSSSS....',
    '...SKKKS....',
    '...K...K....',
    '....KKK.....',
    '..BBBBBBB...',
    '.BYYYYYYYB..',
    '.BYOOOOOYB..',
    '.BYOORROYB..',
    '.BYORRROYB..',
    '.BYOORROYB..',
    '.BYOOOOOYB..',
    '.BYYYYYYYB..',
    '..BBBBBBB...',
    '...BBBBB....',
  ];
  function lantern(scale = 6) {
    return pix(LANTERN, { S: '#f0c8a0', K: '#9aa3b5', B: '#3a3f55', Y: '#ffe9a8', O: '#ffb347', R: '#ff7a2e' }, scale, 'lantern');
  }

  const FLAME = [['..Y...', '.YY.Y.', '.YOY..', 'YOOOY.', 'YORROY', '.YRRY.'], { Y: '#ffd45e', O: '#ff9a2e', R: '#e8552b' }];
  function flame(scale = 4) { return pix(FLAME[0], FLAME[1], scale, ''); }

  return { CLOAKS, ELEMENT, adventurer, walker, sitting, portrait, ghost, dmHood, merchant, lantern, icon, flame };
})();
