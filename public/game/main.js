// Game screen: state machine, update loop, collisions, rendering, input.

import { SPR, drawSprite } from './sprites.js';
import { sfx, unlock, toggleMute, isReady } from './audio.js';
import * as HS from './hiscore.js';
import { Net } from './net.js';
import { W, H, entryPlan, divePath } from './waves.js';
import { Player, Enemy, Boss, Bullet, PowerUp, ENEMY_INFO, POWERS, pickPower, rand, clamp, pick } from './entities.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv');
cv.width = W;
cv.height = H;
const ctx = cv.getContext('2d');
const FONT = '8px "Press Start 2P", monospace';
const BIG = '16px "Press Start 2P", monospace';

// ---------- state ----------

const g = {
  state: 'attract', // attract | play | gameover | entry | scores
  stateT: 0,
  t: 0,
  wave: 0,
  d: difficulty(1),
  players: [new Player(1), new Player(2)],
  enemies: [], bullets: [], ebullets: [], powerups: [], particles: [], popups: [], rings: [],
  boss: null,
  banner: null,
  clearT: null, diveT: 3, summonT: 6,
  shakeAmt: 0, flashT: 0, paused: false, slowT: 0,
  swayX: 0, spread: 1,
  hiscores: HS.load(),
  hi: 0,
  entry: null,
  newEntries: [],
};
g.hi = g.hiscores[0]?.s || 0;

function difficulty(w) {
  return {
    speed: Math.min(170, 105 + w * 5),
    diveEvery: Math.max(0.5, 2.1 - w * 0.15),
    maxDivers: Math.min(8, 2 + Math.floor(w / 2)),
    shootRate: 0.5 + w * 0.12,
    bulletSpeed: Math.min(170, 95 + w * 7),
    maxEBullets: 5 + w,
  };
}

// helpers used by entities
g.slotPos = (s) => ({ x: W / 2 + s.col * 16 * g.spread + g.swayX, y: 40 + s.row * 15 });
g.shake = (a) => { g.shakeAmt = Math.max(g.shakeAmt, a); };
g.alivePlayers = () => g.players.filter((p) => p.joined && !p.out && p.alive);
g.targetPlayer = () => pick(g.alivePlayers()) || { x: W / 2, y: H };
g.fx = (slot, k, v) => net.send({ t: 'fx', s: slot, k, v });
g.popup = (x, y, text, color = '#3ae0ff') => g.popups.push({ x, y, text, color, t: 1 });
g.showBanner = (text, color, t, sub = '') => { g.banner = { text, color, t, sub }; };
g.burst = (x, y, c, n = 16, speed = 1) => {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(20, 110) * speed;
    g.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.8), c });
  }
};
g.enemyShoot = (x, y, a, speed, force = false) => {
  if (!force && g.ebullets.length >= g.d.maxEBullets) return;
  g.ebullets.push(new Bullet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, 0));
};
g.dropPowerup = (x, y, chance) => {
  if (Math.random() < chance) g.powerups.push(new PowerUp(x, y, pickPower()));
};
// Score a kill through the player's combo: quick kills raise the multiplier.
const COMBO_TIME = 1.5;
g.kill = (slot, pts, x, y) => {
  const p = g.players[slot - 1];
  if (!p || !p.joined) return pts;
  if (!g.bombing) {
    const before = p.mult;
    p.combo = p.comboT > 0 ? p.combo + 1 : 1;
    p.comboT = COMBO_TIME;
    if (p.mult > before) {
      g.popup(x, y - 10, `x${p.mult}`, '#ffd23a');
      sfx.combo(p.mult);
      g.fx(slot, 'combo', p.mult);
    }
  }
  const total = pts * p.mult;
  g.addScore(slot, total);
  return total;
};
// A captured ship was freed: it joins its owner as a DOUBLE ship (or the
// rescuer if the owner can't take it), else it comes back as a spare life.
g.rescue = (owner, x, y, by) => {
  const ok = (p) => p && p.joined && !p.out && p.alive && !p.capture;
  const o = g.players[owner - 1];
  const to = ok(o) ? o : ok(g.players[by - 1]) ? g.players[by - 1] : null;
  if (to) {
    to.twin = true;
    to.x = clamp(to.x, 15, W - 15);
    g.showBanner('FIGHTER RESCUED', '#2fd06a', 2);
    g.fx(to.slot, 'rescue');
  } else if (o.joined && !o.out) {
    o.lives = Math.min(6, o.lives + 1);
    g.popup(x, y, 'SHIP BACK', '#2fd06a');
    g.fx(o.slot, 'rescue');
  }
  sfx.rescue();
};
g.addScore = (slot, pts) => {
  const p = g.players[slot - 1];
  if (!p.joined) return;
  p.score += pts;
  if (p.score >= p.nextLife) {
    p.nextLife += 30000;
    if (p.lives < 6 && !p.out) {
      p.lives++;
      sfx.extra();
      g.fx(slot, 'extra');
      g.popup(p.x, p.y - 14, '1UP', '#2fd06a');
    }
  }
  g.hi = Math.max(g.hi, p.score);
};

function setState(s) {
  g.state = s;
  g.stateT = 0;
}

// ---------- network ----------

const netIn = [{ x: 0, y: 0, fire: false }, { x: 0, y: 0, fire: false }];

const net = new Net((m) => {
  switch (m.t) {
    case 'room':
      $('qr').src = m.qr;
      $('code').textContent = m.code;
      $('url').textContent = m.joinUrl.replace(/^https:\/\//, '');
      m.players.forEach((on, i) => { g.players[i].connected = on; });
      $('net').textContent = '';
      break;
    case 'pj': {
      const p = g.players[m.s - 1];
      p.connected = m.on;
      p.rtt = 0;
      if (!m.on) netIn[m.s - 1] = { x: 0, y: 0, fire: false };
      else {
        sfx.join();
        p.lastSt = null;
        // Phone reconnected while its initials are still pending: ask again.
        const e = g.state === 'entry' && g.entry.list.find((x) => x.slot === m.s && !x.done);
        if (e) net.send({ t: 'ask', s: m.s, score: e.s });
      }
      break;
    }
    case 'in': {
      const n = netIn[m.s - 1];
      if (m.f && !n.fire) n.pressed = true; // consumed by the next update tick
      Object.assign(n, { x: clamp(+m.x || 0, -1, 1), y: clamp(+m.y || 0, -1, 1), fire: !!m.f });
      break;
    }
    case 'ping':
      net.send({ t: 'pong', s: m.s, c: m.c });
      g.players[m.s - 1].rtt = +m.rtt || 0;
      updatePanel();
      break;
    case 'bomb':
      bomb(m.s);
      break;
    case 'roll':
      g.players[m.s - 1].roll(clamp(Math.round(+m.d || 0), -1, 1), g);
      break;
    case 'initials':
      submitInitials(m.s, m.v);
      break;
    case 'offline':
      $('net').textContent = 'SERVER OFFLINE - RECONNECTING';
      g.players.forEach((p) => { p.connected = false; });
      break;
  }
  updatePanel();
});

// ---------- keyboard ----------

const keys = new Set();
const KB = [
  { l: 'ArrowLeft', r: 'ArrowRight', u: 'ArrowUp', d: 'ArrowDown', fire: 'Space', bomb: 'KeyB', roll: 'ShiftRight' },
  { l: 'KeyA', r: 'KeyD', u: 'KeyW', d: 'KeyS', fire: 'KeyF', bomb: 'KeyG', roll: 'ShiftLeft' },
];

function unlockAudio() {
  unlock();
  setTimeout(updatePanel, 50);
}

addEventListener('keydown', (e) => {
  unlockAudio();
  if (g.state === 'entry' && entryKey(e)) return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  for (const p of g.players) {
    if (kbSchemes(p.slot - 1).some((k) => k.bomb === e.code)) bomb(p.slot);
    if (kbSchemes(p.slot - 1).some((k) => k.roll === e.code)) p.roll(0, g);
  }
  if (e.code === 'KeyP' && g.state === 'play') g.paused = !g.paused;
  if (e.code === 'KeyM') { $('mute').textContent = toggleMute() ? 'SOUND OFF (M)' : ''; }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('pointerdown', unlockAudio);

// Keyboard schemes drive the slots that have no phone: arrows go to the
// first free slot, WASD to the second. With one free slot, both drive it.
function kbSchemes(i) {
  const free = g.players.filter((p) => !p.connected).map((p) => p.slot - 1);
  if (!free.includes(i)) return [];
  return free.length === 1 ? KB : [KB[free.indexOf(i)]];
}

const kbFireName = (i) => kbSchemes(i).map((k) => (k.fire === 'Space' ? 'SPC' : 'F')).join('/');

function readInput(i) {
  const n = netIn[i];
  let kx = 0, ky = 0, kf = false;
  for (const k of kbSchemes(i)) {
    kx += (keys.has(k.r) ? 1 : 0) - (keys.has(k.l) ? 1 : 0);
    ky += (keys.has(k.u) ? 1 : 0) - (keys.has(k.d) ? 1 : 0);
    kf ||= keys.has(k.fire);
  }
  return { x: clamp(kx, -1, 1) || n.x, y: clamp(ky, -1, 1) || n.y, fire: kf || n.fire };
}

// ---------- game flow ----------

function onFirePress(p) {
  if (g.state === 'attract') startGame(p);
  else if (g.state === 'play' && (!p.joined || p.out) && !g.paused) {
    // Join mid-game, or continue (score resets) after running out of ships.
    const cont = p.joined;
    p.start(clamp(g.players[2 - p.slot].x + (p.slot === 1 ? -40 : 40), 16, W - 16));
    sfx.join();
    g.showBanner(`${p.slot}UP ${cont ? 'CONTINUE' : 'JOINED'}`, p.slot === 1 ? '#ffffff' : '#7cd8ff', 1.5);
    updatePanel();
  } else if (g.state === 'scores' && g.stateT > 1.5) setState('attract');
}

function startGame(p) {
  Object.assign(g, { enemies: [], bullets: [], ebullets: [], powerups: [], boss: null, wave: 0, paused: false, slowT: 0 });
  g.players.forEach((q) => { q.joined = false; q.out = false; q.alive = false; q.score = 0; });
  p.start(W / 2);
  setState('play');
  sfx.start();
  startWave();
}

function startWave() {
  g.wave++;
  g.d = difficulty(g.wave);
  Object.assign(g, { enemies: [], ebullets: [], boss: null, clearT: null, diveT: 3, summonT: 6 });
  if (g.wave % 4 === 0) {
    g.boss = new Boss(g);
    g.showBanner('WARNING', '#e8263a', 3, 'BOSS APPROACHING');
    sfx.alarm();
    g.players.forEach((p) => p.joined && g.fx(p.slot, 'boss'));
  } else {
    for (const e of entryPlan(g.wave)) g.enemies.push(new Enemy(e.slot, e.path, e.delay));
    g.showBanner(`STAGE ${g.wave}`, '#3ae0ff', 2.2);
    if (g.wave > 1) sfx.stage();
  }
}

function launchDive(formed) {
  const e = pick(formed);
  // Commanders sometimes come down to tractor-beam a ship instead (one at a time).
  if (e.type === 'cmdr' && !e.captive && Math.random() < 0.4 &&
      !g.enemies.some((o) => o.captive || o.mode === 'beamgo' || o.mode === 'beam')) {
    const victim = pick(g.alivePlayers().filter((p) => !p.twin));
    if (victim) { e.startBeam(clamp(victim.x, 24, W - 24)); return; }
  }
  const tx = g.targetPlayer().x + rand(-24, 24);
  e.startDive(tx);
  // Commanders bring up to two butterfly escorts.
  if (e.type === 'cmdr') {
    formed.filter((o) => o !== e && o.slot.row === 1 && Math.abs(o.slot.col - e.slot.col) <= 1.5)
      .slice(0, 2)
      .forEach((o, i) => o.startDive(tx + (i ? 16 : -16)));
  }
  sfx.dive();
}

function summonMinions() {
  const tx = g.targetPlayer().x;
  const sx = rand(40, W - 40);
  for (let i = 0; i < 3; i++) {
    const path = divePath({ x: sx, y: -12 }, tx + (i - 1) * 18);
    g.enemies.push(new Enemy({ type: 'bee', minion: true }, path, i * 0.18));
  }
}

function bomb(slot) {
  const p = g.players[slot - 1];
  if (p.capture) { p.escape(g); return; } // shake / bomb breaks a tractor beam
  if (g.state !== 'play' || g.paused || !p.joined || !p.alive || p.out || p.bombs <= 0) return;
  p.bombs--;
  g.flashT = 0.35;
  g.shake(12);
  sfx.bomb();
  g.fx(slot, 'bomb');
  g.rings.push({ x: p.x, y: p.y, r: 0 });
  g.ebullets.forEach((b) => { b.dead = true; });
  const live = g.enemies.filter((e) => !e.dead && e.mode !== 'wait');
  const flying = live.filter((e) => e.mode !== 'form');
  const formed = live.filter((e) => e.mode === 'form').sort(() => Math.random() - 0.5).slice(0, 10);
  g.bombing = true; // bomb kills don't build the combo
  [...flying, ...formed].forEach((e) => e.hit(99, g, slot));
  if (g.boss) g.boss.hit(25, g, slot);
  g.bombing = false;
}

// ---------- high score entry ----------

function beginEntry() {
  const pending = g.players.filter((p) => p.joined && HS.qualifies(g.hiscores, p.score));
  if (!pending.length) { g.newEntries = []; setState('scores'); return; }
  g.entry = { t: 30, list: pending.map((p) => ({ slot: p.slot, s: p.score, w: g.wave, n: '', done: false })) };
  pending.forEach((p) => net.send({ t: 'ask', s: p.slot, score: p.score }));
  setState('entry');
}

const cleanName = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);

function submitInitials(slot, v) {
  if (g.state !== 'entry') return;
  const e = g.entry.list.find((x) => x.slot === slot && !x.done);
  if (!e) return;
  e.n = cleanName(v) || e.n;
  e.done = true;
  sfx.tick();
}

function entryKey(e) {
  const cur = g.entry.list.find((x) => !x.done);
  if (!cur) return false;
  if (/^Key[A-Z]$|^Digit[0-9]$/.test(e.code) && cur.n.length < 3) { cur.n += e.code.slice(-1); sfx.tick(); }
  else if (e.code === 'Backspace') cur.n = cur.n.slice(0, -1);
  else if (e.code === 'Enter' && cur.n) { cur.done = true; net.send({ t: 'askdone', s: cur.slot }); }
  else return false;
  e.preventDefault();
  return true;
}

function finishEntry() {
  g.newEntries = g.entry.list.map((x) => ({ n: (x.n || `P${x.slot}`).padEnd(3, ' '), s: x.s, w: x.w }));
  g.newEntries.forEach((x) => HS.insert(g.hiscores, x));
  g.entry.list.forEach((x) => !x.done && net.send({ t: 'askdone', s: x.slot }));
  g.entry = null;
  setState('scores');
}

// ---------- update ----------

const stars = Array.from({ length: 70 }, () => ({
  x: rand(0, W), y: rand(0, H), v: rand(12, 50), p: rand(0, 6),
  c: pick(['#ffffff', '#ffff66', '#66ffff', '#ff66ff', '#66ff66', '#ff6666', '#6666ff']),
}));

function update(dt) {
  g.t += dt;
  g.stateT += dt;

  for (const s of stars) {
    s.y += s.v * dt * (g.state === 'play' ? 1 : 0.5);
    if (s.y > H) { s.y = 0; s.x = rand(0, W); }
  }

  g.players.forEach((p, i) => {
    const inp = readInput(i);
    const pressed = (inp.fire && !p.prevFire) || netIn[i].pressed;
    netIn[i].pressed = false;
    p.prevFire = inp.fire;
    p.input = inp;
    if (pressed) onFirePress(p);
  });

  if (g.paused) return;

  g.swayX = Math.sin(g.t * 0.7) * 8;
  g.spread = 1 + 0.06 * Math.sin(g.t * 1.5);
  if (g.banner && (g.banner.t -= dt) <= 0) g.banner = null;
  g.flashT = Math.max(0, g.flashT - dt);
  g.shakeAmt = Math.max(0, g.shakeAmt - dt * 30);

  for (const q of g.particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.98; q.vy *= 0.98; q.life -= dt; }
  for (const q of g.popups) { q.y -= 14 * dt; q.t -= dt; }
  for (const r of g.rings) r.r += 300 * dt;
  g.particles = g.particles.filter((q) => q.life > 0);
  g.popups = g.popups.filter((q) => q.t > 0);
  g.rings = g.rings.filter((r) => r.r < 360);

  if (g.state === 'play' || g.state === 'gameover') updateWorld(dt);

  if (g.state === 'gameover' && g.stateT > 4) beginEntry();
  if (g.state === 'entry') {
    g.entry.t -= dt;
    if (g.entry.t <= 0 || g.entry.list.every((x) => x.done)) finishEntry();
  }
  if (g.state === 'scores' && g.stateT > 9) setState('attract');

  sendStatus(dt);
}

function updateWorld(dt) {
  // SLOW power-up: enemies and their bullets run at 40% speed.
  const edt = g.slowT > 0 ? dt * 0.4 : dt;
  g.slowT = Math.max(0, g.slowT - dt);
  g.players.forEach((p) => p.update(dt, g));
  g.enemies.forEach((e) => e.update(edt, g));
  if (g.boss) g.boss.update(edt, g);
  g.bullets.forEach((b) => b.update(dt, g));
  g.ebullets.forEach((b) => b.update(edt));
  g.powerups.forEach((u) => u.update(dt));

  if (g.state === 'play') {
    collide();
    schedule(edt);
  }

  g.bullets = g.bullets.filter((b) => !b.dead);
  g.ebullets = g.ebullets.filter((b) => !b.dead);
  g.powerups = g.powerups.filter((u) => !u.dead);
  g.enemies = g.enemies.filter((e) => !e.dead);
  if (g.boss && g.boss.dead) g.boss = null;

  if (g.state !== 'play') return;

  if (!g.enemies.length && !g.boss) {
    if (g.clearT === null) g.clearT = 2;
    else if ((g.clearT -= dt) <= 0) startWave();
  }

  const joined = g.players.filter((p) => p.joined);
  if (joined.length && joined.every((p) => p.out)) {
    setState('gameover');
    sfx.gameover();
  }
}

const near = (a, b, rx, ry) => Math.abs(a.x - b.x) < rx && Math.abs(a.y - b.y) < ry;

function collide() {
  for (const b of g.bullets) {
    for (const e of g.enemies) {
      if (e.dead || e.mode === 'wait' || !near(b, e, 7, 6)) continue;
      b.dead = true;
      e.hit(1, g, b.owner);
      break;
    }
    if (!b.dead && g.boss && g.boss.collides(b.x, b.y)) {
      b.dead = true;
      g.boss.hit(1, g, b.owner);
    }
  }
  for (const p of g.alivePlayers()) {
    const wide = p.twin ? 7 : 0; // DOUBLE ship is wider
    for (const b of g.ebullets) {
      if (b.dead || !near(b, p, 4 + wide, 5)) continue;
      b.dead = true;
      if (p.hit(g)) break;
    }
    if (!p.alive) continue;
    for (const e of g.enemies) {
      if (e.dead || e.mode === 'wait' || e.mode === 'form' || !near(e, p, 9 + wide, 8)) continue;
      if (p.invuln > 0 || p.rollT > 0 || p.capture) continue;
      e.hit(99, g, p.slot);
      if (p.hit(g)) break;
    }
    for (const u of g.powerups) {
      if (!u.dead && p.alive && near(u, p, 10, 10)) { u.dead = true; u.apply(p, g); }
    }
  }
}

function schedule(dt) {
  if (g.boss) {
    if (g.boss.mode === 'fight' && (g.summonT -= dt) <= 0) {
      g.summonT = Math.max(4, 8 - g.wave * 0.2);
      summonMinions();
    }
    return;
  }
  const entering = g.enemies.some((e) => e.mode === 'wait' || e.mode === 'enter');
  if (entering || !g.alivePlayers().length || (g.diveT -= dt) > 0) return;
  g.diveT = g.d.diveEvery * rand(0.6, 1.3) * (g.enemies.length <= 6 ? 0.5 : 1);
  const formed = g.enemies.filter((e) => e.mode === 'form' && !e.slot.minion);
  const diving = g.enemies.filter((e) => ['dive', 'return', 'beamgo', 'beam'].includes(e.mode)).length;
  if (formed.length && diving < g.d.maxDivers) launchDive(formed);
}

// Push score/lives/bombs to phones a few times a second (only when changed).
let statusT = 0;
function sendStatus(dt) {
  if ((statusT -= dt) > 0) return;
  statusT = 0.25;
  for (const p of g.players) {
    if (!p.connected) continue;
    const st = {
      t: 'st', s: p.slot, state: g.state, joined: p.joined, out: p.out, score: p.score,
      lives: p.joined ? Math.max(0, p.lives) : 0, bombs: p.bombs || 0, power: p.power || null,
      shield: p.shield > 0, twin: !!p.twin, wave: g.wave,
      level: p.power ? p.level : 0, mult: p.joined ? p.mult : 1, capture: !!p.capture,
    };
    const key = JSON.stringify(st);
    if (key !== p.lastSt) { p.lastSt = key; net.send(st); }
  }
}

// ---------- render ----------

function text(s, x, y, color = '#fff', align = 'left', font = FONT) {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.fillText(s, Math.round(x), Math.round(y));
}

const blinkOn = (rate = 2) => Math.floor(g.t * rate * 2) % 2 === 0;

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  ctx.textBaseline = 'top';
  ctx.lineWidth = 1;

  for (const s of stars) {
    if (Math.sin(g.t * 3 + s.p) > -0.3) { ctx.fillStyle = s.c; ctx.fillRect(s.x | 0, s.y | 0, 1, 1); }
  }

  ctx.save();
  if (g.shakeAmt > 0) ctx.translate(Math.round(rand(-1, 1) * g.shakeAmt * 0.3), Math.round(rand(-1, 1) * g.shakeAmt * 0.3));
  if (g.state === 'play' || g.state === 'gameover') drawWorld();
  ctx.restore();

  if (g.slowT > 0 && (g.slowT > 1.5 || blinkOn(2))) {
    ctx.fillStyle = 'rgba(176, 74, 255, 0.12)';
    ctx.fillRect(0, 0, W, H);
  }

  if (g.flashT > 0) {
    ctx.globalAlpha = Math.min(0.8, g.flashT * 2.5);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  drawHud();
  if (g.state === 'attract') drawAttract();
  if (g.state === 'gameover') text('GAME OVER', W / 2, 140, '#e8263a', 'center');
  if (g.state === 'entry') drawEntry();
  if (g.state === 'scores') drawScores();
  if (g.banner && (g.state === 'play')) {
    text(g.banner.text, W / 2, 132, g.banner.color, 'center');
    if (g.banner.sub) text(g.banner.sub, W / 2, 146, '#ffffff', 'center');
  }
  if (g.paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 120, W, 40);
    text('PAUSED', W / 2, 136, '#ffd23a', 'center');
  }
}

function drawWorld() {
  g.powerups.forEach((u) => u.draw(ctx));
  g.enemies.forEach((e) => e.draw(ctx, g));
  if (g.boss) g.boss.draw(ctx, g);
  g.bullets.forEach((b) => b.draw(ctx));
  g.ebullets.forEach((b) => b.draw(ctx));
  g.players.forEach((p) => p.draw(ctx, g));
  for (const q of g.particles) {
    ctx.fillStyle = q.c;
    const s = q.life > 0.45 ? 2 : 1;
    ctx.fillRect(q.x | 0, q.y | 0, s, s);
  }
  ctx.strokeStyle = '#ff8a1e';
  for (const r of g.rings) {
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const q of g.popups) text(q.text, q.x, q.y - 4, q.color, 'center');
}

function drawHud() {
  const [p1, p2] = g.players;
  const label = (p, x, align) => {
    const show = g.state !== 'play' || !p.joined || p.out || blinkOn(1) || !p.alive;
    if (show) text(`${p.slot}UP`, x, 1, '#e8263a', align);
    if (p.joined || p.score) text(String(p.score).padStart(2, '0'), x, 10, '#ffffff', align);
    if (p.joined && p.mult > 1) text(`x${p.mult}`, x, 19, '#ffd23a', align);
  };
  label(p1, 8, 'left');
  label(p2, W - 8, 'right');
  text('HIGH SCORE', W / 2, 1, '#e8263a', 'center');
  text(String(g.hi), W / 2, 10, '#ffffff', 'center');

  if (g.state !== 'play' && g.state !== 'gameover') return;

  const reserve = (p, x0, dir) => {
    if (!p.joined || p.out) {
      const how = p.connected ? 'FIRE' : kbFireName(p.slot - 1) || 'FIRE';
      if (blinkOn(0.5)) text(`${how}=${p.out ? 'CONT' : 'JOIN'}`, x0, 279, '#6b6b80', dir > 0 ? 'left' : 'right');
      return;
    }
    let x = x0;
    for (let i = 0; i < Math.max(0, p.lives - (p.alive ? 1 : 0)); i++) {
      drawSprite(ctx, p.slot === 1 ? SPR.ship1 : SPR.ship2, x + dir * 4, 282, 0, 0.6);
      x += dir * 10;
    }
    for (let i = 0; i < p.bombs; i++) {
      ctx.fillStyle = '#ff8a1e';
      ctx.fillRect(Math.round(x + dir * 3) - 2, 280, 4, 4);
      x += dir * 6;
    }
  };
  reserve(p1, 4, 1);
  reserve(p2, W - 4, -1);
  text(`S${g.wave}`, W / 2, 279, '#ffd23a', 'center');

  if (g.boss && g.boss.mode === 'fight') {
    ctx.fillStyle = '#55556a';
    ctx.fillRect(40, 21, 144, 4);
    ctx.fillStyle = g.boss.rage ? '#ff4fd8' : '#e8263a';
    ctx.fillRect(40, 21, Math.ceil(144 * g.boss.hp / g.boss.maxHp), 4);
  }
}

function drawAttract() {
  text('GYRO', W / 2, 30, '#ffd23a', 'center', BIG);
  text('STRIKE', W / 2, 50, '#e8263a', 'center', BIG);
  text('TILT YOUR PHONE TO FLY', W / 2, 74, '#3ae0ff', 'center');

  const page = Math.floor(g.stateT / 7) % 3;
  if (page === 0) {
    text('-SCORE ADVANCE TABLE-', W / 2, 96, '#ffffff', 'center');
    text('FORM DIVE', 168, 108, '#6b6b80', 'center');
    ['cmdr', 'tank', 'fly', 'zig', 'split', 'bee'].forEach((type, i) => {
      const y = 122 + i * 15;
      drawSprite(ctx, SPR[type][Math.floor(g.t * 2.5) % 2], 58, y + 3);
      const [a, b] = ENEMY_INFO[type].pts;
      text(`${String(a).padStart(4)} ${String(b).padStart(4)}`, 168, y, '#ffffff', 'center');
    });
  } else if (page === 1) {
    text('-POWER UPS-', W / 2, 96, '#ffffff', 'center');
    Object.entries(POWERS).forEach(([k, v], i) => {
      const x = i % 2 ? 116 : 14;
      const y = 114 + Math.floor(i / 2) * 18;
      ctx.fillStyle = v.color;
      ctx.fillRect(x, y - 1, 10, 10);
      text(v.glyph || k, x + 1, y, '#000');
      text(v.name, x + 14, y, v.color);
    });
  } else {
    text('-TOP 10-', W / 2, 96, '#ffffff', 'center');
    drawTable(110, []);
  }

  if (blinkOn(1)) text('PRESS FIRE', W / 2, 228, '#ffffff', 'center');
  text('SCAN QR TO JOIN', W / 2, 244, '#6b6b80', 'center');
  g.players.forEach((p, i) => {
    text(`${p.slot}UP ${p.connected ? 'PHONE' : `KEY ${kbFireName(i)}`}`, i ? W - 8 : 8, 262, p.connected ? '#2fd06a' : '#6b6b80', i ? 'right' : 'left');
  });
}

function drawTable(y0, highlight) {
  g.hiscores.slice(0, 10).forEach((e, i) => {
    const hot = highlight.includes(e);
    const c = hot ? (blinkOn(2) ? '#ffd23a' : '#ffffff') : ['#3ae0ff', '#ffffff'][i % 2];
    text(`${String(i + 1).padStart(2)} ${String(e.s).padStart(7)} ${e.n}`, W / 2, y0 + i * 11, c, 'center');
  });
}

function drawEntry() {
  text('NEW HIGH SCORE!', W / 2, 70, '#ffd23a', 'center');
  g.entry.list.forEach((e, i) => {
    const y = 104 + i * 30;
    const p = g.players[e.slot - 1];
    const name = e.n.padEnd(3, e.done ? ' ' : '_');
    text(`${e.slot}UP ${String(e.s).padStart(7)}`, W / 2, y, e.slot === 1 ? '#ffffff' : '#7cd8ff', 'center');
    text(e.done ? `${name} OK` : name, W / 2, y + 11, e.done ? '#2fd06a' : (blinkOn(2) ? '#ffd23a' : '#ffffff'), 'center');
    if (!e.done) text(p.connected ? 'TYPE ON PHONE' : 'TYPE + ENTER', W / 2, y + 20, '#6b6b80', 'center');
  });
  text(String(Math.ceil(g.entry.t)), W / 2, 200, '#e8263a', 'center');
}

function drawScores() {
  text('-TOP 10-', W / 2, 70, '#ffffff', 'center');
  drawTable(90, g.newEntries);
  if (g.stateT > 1.5 && blinkOn(1)) text('PRESS FIRE', W / 2, 228, '#ffffff', 'center');
}

// ---------- side panel ----------

function updatePanel() {
  g.players.forEach((p, i) => {
    const el = $(`slot${i + 1}`);
    el.classList.toggle('on', p.connected || p.joined);
    el.querySelector('.st').textContent = p.connected ? `PHONE READY${p.rtt ? ` ${p.rtt}MS` : ''}` : p.joined ? 'KEYBOARD' : 'WAITING';
  });
  $('sound').hidden = isReady();
}

// ---------- main loop ----------

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;

function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  render();
  requestAnimationFrame(frame);
}

// Wait briefly for the pixel font, but never let a slow or blocked font
// request keep the game from starting.
Promise.race([
  document.fonts?.load(FONT),
  new Promise((r) => setTimeout(r, 1500)),
]).catch(() => {}).finally(() => {
  updatePanel();
  requestAnimationFrame(frame);
});

// Debug handle for the browser console.
window.gyro = g;
