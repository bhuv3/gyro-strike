// Pixel-art sprites defined as strings. Each character is a palette key,
// '.' is transparent. Built once into offscreen canvases.

const PAL = {
  w: '#ffffff', r: '#e8263a', b: '#2a6cff', y: '#ffd23a', g: '#2fd06a',
  p: '#b04aff', c: '#3ae0ff', o: '#ff8a1e', m: '#ff4fd8', k: '#55556a',
};

function build(rows, pal = PAL) {
  const w = rows[0].length;
  rows.forEach((r, i) => { if (r.length !== w) console.warn('sprite row width mismatch', i, r); });
  const c = document.createElement('canvas');
  c.width = w;
  c.height = rows.length;
  const x = c.getContext('2d');
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      x.fillStyle = pal[ch] || ch;
      x.fillRect(i, j, 1, 1);
    }
  });
  return c;
}

// Mirror a left half (center column last) into a symmetric sprite.
const mirror = (half) => half.map((r) => r + [...r.slice(0, -1)].reverse().join(''));

const white = Object.fromEntries(Object.keys(PAL).map((k) => [k, '#ffffff']));

const SHIP = [
  '......w......',
  '......w......',
  '.....www.....',
  '.....www.....',
  '..r..wbw..r..',
  '..r.wwbww.r..',
  '..w.wwwww.w..',
  'w.wwwrwrwww.w',
  'w.wwrrwrrww.w',
  'wwwwr.w.rwwww',
  'www...w...www',
  'ww.........ww',
];

const BEE = [[
  '...y...y...',
  '....y.y....',
  'b..yyyyy..b',
  'bb.yryry.bb',
  'bbbyyyyybbb',
  '.bbyyyyybb.',
  '...yyyyy...',
  '....y.y....',
], [
  '...y...y...',
  'bb..y.y..bb',
  'bbbyyyyybbb',
  '.bbyryrybb.',
  '...yyyyy...',
  '...yyyyy...',
  '...yyyyy...',
  '....y.y....',
]];

const FLY = [[
  '...w...w...',
  '....w.w....',
  'rr..www..rr',
  'rrr.wbw.rrr',
  'rrrrwwwrrrr',
  '.rrrwwwrrr.',
  '..r.www.r..',
  '....w.w....',
], [
  '...w...w...',
  '....w.w....',
  '....www....',
  '.rr.wbw.rr.',
  'rrrrwwwrrrr',
  'rrrrwwwrrrr',
  'rrr.www.rrr',
  'rr..w.w..rr',
]];

const CMDR = [[
  '....y...y....',
  '.....y.y.....',
  '..ggggggggg..',
  '.ggwwgggwwgg.',
  'gggwbgggbwggg',
  'ggggggggggggg',
  'g.ggg.g.ggg.g',
  'g..gg...gg..g',
  'g...g...g...g',
  '.....ggg.....',
], [
  '....y...y....',
  '.....y.y.....',
  '..ggggggggg..',
  '.ggwwgggwwgg.',
  'gggwbgggbwggg',
  '.ggggggggggg.',
  '..ggg.g.ggg..',
  '.gg.g...g.gg.',
  'gg..g...g..gg',
  '.....ggg.....',
]];

const TANK = [[
  '..o.....o..',
  '..kkkkkkk..',
  '.kkokkkokk.',
  'kkkkkkkkkkk',
  'kokkwwwkkok',
  'kkkkwrwkkkk',
  '.kk.kkk.kk.',
  '.k...k...k.',
], [
  '..o.....o..',
  '..kkkkkkk..',
  '.kkokkkokk.',
  'kkkkkkkkkkk',
  'kokkwwwkkok',
  'kkkkwrwkkkk',
  '.kk.kkk.kk.',
  'k....k....k',
]];

const ZIG = [[
  '.....m.....',
  'c...mmm...c',
  'cc..mwm..cc',
  'ccccmmmcccc',
  '.cc.mmm.cc.',
  '.....m.....',
  '.....m.....',
  '.....m.....',
], [
  '.....m.....',
  '....mmm....',
  'cc..mwm..cc',
  'ccccmmmcccc',
  'ccc.mmm.ccc',
  'c....m....c',
  '.....m.....',
  '.....m.....',
]];

const SPLIT = [[
  '...p...p...',
  '....ppp....',
  '..ppgggpp..',
  '.ppgwgwgpp.',
  '.ppgggggpp.',
  '..ppgggpp..',
  '.p..ppp..p.',
  'p.........p',
], [
  '...p...p...',
  '....ppp....',
  '..ppgggpp..',
  '.ppgwgwgpp.',
  '.ppgggggpp.',
  '..ppgggpp..',
  '..p.ppp.p..',
  '..p.....p..',
]];

const MINI = [[
  '..p.p..',
  '.ppppp.',
  'pgwgwgp',
  'ppppppp',
  '.p...p.',
], [
  '..p.p..',
  '.ppppp.',
  'pgwgwgp',
  'ppppppp',
  'p.....p',
]];

const BOSS = mirror([
  '..........o...yy',
  '...........o.yyy',
  '......rrrrrrrrrr',
  '....rrrrrrrrrrrr',
  '...rrrwwwrrrrrrr',
  '..rrrwwbbwrrrrrr',
  '..rrrwwbbwrrrryy',
  '.rrrrrwwwrrrryyy',
  'rrrrrrrrrrrryyyy',
  'rrppprrrrrrryyyy',
  'rpppppprrrrrrryy',
  'rppppppprrrrrrrr',
  'rr.pppppprrrrrrr',
  'r...ppp..rrrr.rr',
  'r....p....rr..rr',
  'r.........rr...r',
  '..........r....r',
  '...............r',
]);

export const SPR = {
  ship1: build(SHIP),
  ship2: build(SHIP, { ...PAL, w: '#7cd8ff', r: '#ffd23a', b: '#e8263a' }),
  shipCaptive: build(SHIP, { ...PAL, w: '#e8263a', r: '#ffffff', b: '#ffd23a' }),
  bee: BEE.map((f) => build(f)),
  fly: FLY.map((f) => build(f)),
  cmdr: CMDR.map((f) => build(f)),
  cmdrHit: CMDR.map((f) => build(f, { ...PAL, g: '#b04aff' })),
  tank: TANK.map((f) => build(f, { ...PAL, k: '#9a9ab0' })),
  zig: ZIG.map((f) => build(f)),
  split: SPLIT.map((f) => build(f)),
  mini: MINI.map((f) => build(f)),
  boss: build(BOSS),
  bossRage: build(BOSS, { ...PAL, r: '#ff4fd8', p: '#e8263a' }),
  flash: {
    bee: build(BEE[0], white), fly: build(FLY[0], white), cmdr: build(CMDR[0], white), boss: build(BOSS, white),
    tank: build(TANK[0], white), zig: build(ZIG[0], white), split: build(SPLIT[0], white), mini: build(MINI[0], white),
  },
};

// Draw centered at (x, y); rotation snapped to 16 directions for a retro look.
export function drawSprite(ctx, img, x, y, rot = 0, scale = 1) {
  const w = img.width * scale, h = img.height * scale;
  const step = Math.PI / 8;
  rot = Math.round(rot / step) * step;
  if (!rot) {
    ctx.drawImage(img, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
    return;
  }
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(rot);
  ctx.drawImage(img, -Math.round(w / 2), -Math.round(h / 2), w, h);
  ctx.restore();
}
