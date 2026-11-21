// Game objects. Each has update(dt, g) and draw(ctx, g); `g` is the game
// state from main.js (lists, difficulty, and helpers like burst/addScore/fx).

import { SPR, drawSprite } from './sprites.js';
import { sfx } from './audio.js';
import { W, H, followPath, divePath, zigPath, sampleSpline } from './waves.js';

export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// speed: dive speed multiplier
export const ENEMY_INFO = {
  bee: { hp: 1, pts: [50, 100], color: '#ffd23a', speed: 1 },
  fly: { hp: 1, pts: [80, 160], color: '#e8263a', speed: 1 },
  cmdr: { hp: 2, pts: [150, 400], color: '#2fd06a', speed: 1 },
  zig: { hp: 1, pts: [100, 250], color: '#3ae0ff', speed: 1.35 }, // weaving fast diver
  tank: { hp: 3, pts: [120, 300], color: '#ff8a1e', speed: 0.8 }, // armored, 3-way shot
  split: { hp: 1, pts: [90, 200], color: '#b04aff', speed: 1 }, // splits into two minis
  mini: { hp: 1, pts: [60, 60], color: '#2fd06a', speed: 1.2 },
};

// Weapon power-ups (S R L M) replace each other and run on a timer.
export const POWERS = {
  S: { color: '#ffd23a', name: 'SPREAD', weight: 3 },
  R: { color: '#ff4fd8', name: 'RAPID', weight: 3 },
  L: { color: '#ff3b3b', name: 'LASER', weight: 2 },
  M: { color: '#9cff3a', name: 'MISSILE', weight: 2 },
  H: { color: '#3ae0ff', name: 'SHIELD', weight: 2 },
  D: { color: '#c8c8ff', name: 'DOUBLE', weight: 1.5 },
  T: { color: '#b04aff', name: 'SLOW', weight: 1.5 },
  B: { color: '#ff8a1e', name: 'BOMB+', weight: 2 },
  X: { color: '#2fd06a', name: '1UP', weight: 0.5, glyph: '+' },
};
const WEAPON_TIME = { S: 12, R: 12, L: 8, M: 12 };
const SHIELD_TIME = 15;
const SLOW_TIME = 6;
const ROLL_TIME = 0.4;
const CAPTURE_TIME = 1.8; // seconds to break free before the ship is taken
const BEAM_Y = 150; // where a commander parks to use its tractor beam
// Laser per weapon level: beam width, hit reach, damage tick
const LASER = [{ w: 3, r: 6, tick: 0.09 }, { w: 5, r: 9, tick: 0.07 }, { w: 7, r: 12, tick: 0.05 }];

export function pickPower() {
  const entries = Object.entries(POWERS);
  let r = Math.random() * entries.reduce((n, [, v]) => n + v.weight, 0);
  for (const [k, v] of entries) if ((r -= v.weight) < 0) return k;
  return 'S';
}

export class Player {
  constructor(slot) {
    this.slot = slot;
    this.connected = false;
    this.joined = false;
    this.out = false;
    this.alive = false;
    this.score = 0;
    this.lives = 0;
    this.bombs = 0;
    this.combo = 0;
    this.input = { x: 0, y: 0, fire: false };
    this.prevFire = false;
    this.x = W / 2;
    this.y = 262;
  }

  start(x) {
    Object.assign(this, {
      joined: true, out: false, score: 0, lives: 3, bombs: 2, nextLife: 30000,
      power: null, level: 1, powerT: 0, shield: 0, twin: false, laser: false,
      combo: 0, comboT: 0, rollT: 0, rollCD: 0, capture: null,
    });
    this.x = x;
    this.spawn();
  }

  spawn() {
    this.y = 262;
    this.alive = true;
    this.invuln = 2.5;
    this.cool = 0;
    this.rollT = 0;
    this.capture = null;
  }

  // Combo multiplier: x1 for the first 4 quick kills, then +1 every 4, max x5.
  get mult() {
    return this.combo ? Math.min(5, 1 + Math.floor((this.combo - 1) / 4)) : 1;
  }

  resetCombo() {
    this.combo = 0;
    this.comboT = 0;
  }

  // Gun x positions: two when the DOUBLE ship is active.
  guns() {
    return this.twin ? [this.x - 7, this.x + 7] : [this.x];
  }

  update(dt, g) {
    this.laser = false;
    if (!this.joined || this.out) return;
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0 && g.state === 'play') this.spawn();
      return;
    }
    if (this.comboT > 0 && (this.comboT -= dt) <= 0) this.combo = 0;
    this.rollCD = Math.max(0, this.rollCD - dt);
    if (this.capture) { this.updateCapture(dt, g); return; }
    const edge = this.twin ? 15 : 8;
    if (this.rollT > 0) {
      this.rollT -= dt;
      this.x = clamp(this.x + this.rollDir * 260 * dt, edge, W - edge);
    } else {
      this.x = clamp(this.x + this.input.x * 150 * dt, edge, W - edge);
    }
    this.y = clamp(this.y - this.input.y * 100 * dt, 200, 266);
    this.invuln = Math.max(0, this.invuln - dt);
    this.shield = Math.max(0, this.shield - dt);
    if (this.power && (this.powerT -= dt) <= 0) this.power = null;
    this.cool -= dt;
    if (!this.input.fire || g.state !== 'play') return;
    if (this.power === 'L') {
      this.laser = true;
      if (this.cool <= 0) this.fireLaser(g);
    } else if (this.cool <= 0) {
      this.shoot(g);
    }
  }

  shoot(g) {
    const lv = this.level || 1;
    this.cool = this.power === 'R' ? (lv === 3 ? 0.065 : 0.09) : 0.2;
    for (const gx of this.guns()) {
      const barrels = this.power === 'R' && lv >= 2 ? [gx - 2, gx + 2] : [gx];
      for (const bx of barrels) g.bullets.push(new Bullet(bx, this.y - 7, 0, -320, this.slot));
      if (this.power === 'S') {
        for (let i = 1; i <= lv; i++) {
          g.bullets.push(new Bullet(gx, this.y - 7, -70 * i, -310, this.slot));
          g.bullets.push(new Bullet(gx, this.y - 7, 70 * i, -310, this.slot));
        }
      }
    }
    if (this.power === 'M') {
      for (let i = 0; i < lv; i++) {
        this.side = i === 2 ? 0 : -(this.side || 1);
        g.bullets.push(new Missile(this.x + this.side * 6, this.y - 2, this.side, this.slot));
      }
      sfx.missile();
    }
    sfx.shoot();
  }

  // LASER: a beam that hurts everything in its column while fire is held.
  fireLaser(g) {
    const L = LASER[(this.level || 1) - 1];
    this.cool = L.tick;
    for (const gx of this.guns()) {
      for (const e of g.enemies) {
        if (!e.dead && e.mode !== 'wait' && Math.abs(e.x - gx) < L.r && e.y < this.y) e.hit(1, g, this.slot);
      }
      if (g.boss && g.boss.mode === 'fight' && Math.abs(g.boss.x - gx) < 28 + L.r) g.boss.hit(1, g, this.slot);
    }
    sfx.laser();
  }

  // Barrel roll: a quick sideways dash you can't be hit during.
  roll(dir, g) {
    if (!this.joined || this.out || !this.alive || this.capture || this.rollCD > 0 || g.state !== 'play') return;
    this.rollDir = dir || Math.sign(this.input.x) || 1;
    this.rollT = ROLL_TIME;
    this.rollCD = 1.1;
    sfx.roll();
    g.fx(this.slot, 'roll');
  }

  // ---- tractor beam ----

  canBeCaptured() {
    return this.alive && !this.capture && !this.twin && this.rollT <= 0 && this.invuln <= 0;
  }

  startCapture(e, g) {
    this.capture = { t: 0, by: e, x0: this.x, y0: this.y };
    e.beamT = Math.max(e.beamT, CAPTURE_TIME + 0.4);
    this.resetCombo();
    g.fx(this.slot, 'capture');
    g.popup(this.x, this.y - 18, 'BREAK FREE!', '#3ae0ff');
  }

  updateCapture(dt, g) {
    const c = this.capture, e = c.by;
    if (e.dead || e.mode !== 'beam') { this.escape(g); return; }
    c.t += dt;
    const k = Math.min(1, c.t / CAPTURE_TIME);
    this.x = c.x0 + (e.x - c.x0) * k;
    this.y = c.y0 + (e.y + 16 - c.y0) * k;
    if (c.t < CAPTURE_TIME) return;
    // Taken: the commander carries this ship back up to the formation.
    this.capture = null;
    e.captive = this.slot;
    e.beamT = 0;
    this.alive = false;
    this.lives--;
    this.power = null;
    this.respawnT = 2.2;
    this.x = c.x0;
    if (this.lives <= 0) this.out = true;
    sfx.captured();
    g.fx(this.slot, 'lost');
    g.popup(e.x, e.y - 24, 'CAPTURED', '#e8263a');
  }

  escape(g) {
    if (!this.capture) return;
    this.capture.by.beamT = 0;
    this.capture = null;
    this.invuln = 1.5;
    sfx.power();
    g.fx(this.slot, 'escape');
    g.popup(this.x, this.y - 10, 'ESCAPED', '#2fd06a');
  }

  // Returns true if the ship was destroyed.
  hit(g) {
    if (!this.alive || this.invuln > 0 || this.rollT > 0 || this.capture) return false;
    this.resetCombo();
    if (this.shield > 0) {
      this.shield = 0;
      this.invuln = 1;
      sfx.hit();
      g.burst(this.x, this.y, '#3ae0ff', 16);
      g.fx(this.slot, 'hit');
      return false;
    }
    if (this.twin) {
      this.twin = false;
      this.invuln = 1.5;
      sfx.boom();
      g.burst(this.x + 7, this.y, '#ffffff', 20);
      g.shake(4);
      g.fx(this.slot, 'hit');
      return false;
    }
    this.alive = false;
    this.lives--;
    this.power = null;
    this.respawnT = 2.2;
    if (this.lives <= 0) this.out = true;
    g.burst(this.x, this.y, '#ffffff', 30, 1.4);
    g.burst(this.x, this.y, '#e8263a', 30);
    g.burst(this.x, this.y, '#ffd23a', 16, 0.6);
    g.shake(8);
    sfx.die();
    g.fx(this.slot, 'dead');
    return true;
  }

  draw(ctx, g) {
    if (!this.joined || this.out || !this.alive) return;
    const lv = this.level || 1;
    const img = this.slot === 1 ? SPR.ship1 : SPR.ship2;
    if (this.laser) {
      const w = LASER[lv - 1].w;
      for (const gx of this.guns()) {
        const x = Math.round(gx);
        ctx.fillStyle = Math.floor(g.t * 30) % 2 ? '#ff3b3b' : '#ff8a8a';
        ctx.fillRect(x - (w >> 1), 0, w, this.y - 8);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - (lv === 3 ? 1 : 0), 0, lv === 3 ? 3 : 1, this.y - 8);
      }
    }
    if (this.capture) {
      drawSprite(ctx, img, this.x, this.y, this.capture.t * 12);
      return;
    }
    if (this.invuln > 0 && this.rollT <= 0 && Math.floor(g.t * 16) % 2) return;
    // Rolling: squash the sprite horizontally so it looks like it spins.
    const squash = this.rollT > 0 ? Math.max(0.15, Math.abs(Math.cos((1 - this.rollT / ROLL_TIME) * Math.PI * 2))) : 1;
    for (const gx of this.guns()) {
      if (squash < 1) {
        ctx.save();
        ctx.translate(Math.round(gx), Math.round(this.y));
        ctx.scale(squash, 1);
        drawSprite(ctx, img, 0, 0);
        ctx.restore();
      } else {
        drawSprite(ctx, img, gx, this.y);
      }
    }
    if (this.shield > 0 && (this.shield > 3 || Math.floor(g.t * 8) % 2)) {
      ctx.strokeStyle = '#3ae0ff';
      ctx.beginPath();
      ctx.arc(Math.round(this.x) + 0.5, Math.round(this.y) + 0.5, this.twin ? 16 : 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.power) {
      const x = Math.round(this.x - 7), y = Math.round(this.y + 8);
      ctx.fillStyle = POWERS[this.power].color;
      ctx.fillRect(x, y, Math.ceil(14 * this.powerT / WEAPON_TIME[this.power]), 1);
      for (let i = 0; i < lv; i++) ctx.fillRect(x + i * 4, y + 2, 3, 1); // level pips
    }
  }
}

export class Bullet {
  constructor(x, y, vx, vy, owner = 0) {
    Object.assign(this, { x, y, vx, vy, owner, dead: false });
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y < -8 || this.y > H + 8 || this.x < -8 || this.x > W + 8) this.dead = true;
  }

  draw(ctx) {
    const x = Math.round(this.x), y = Math.round(this.y);
    if (this.owner) {
      ctx.fillStyle = this.owner === 1 ? '#ffffff' : '#7cd8ff';
      ctx.fillRect(x, y - 3, 1, 6);
      ctx.fillStyle = '#e8263a';
      ctx.fillRect(x, y - 3, 1, 1);
    } else {
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(x - 1, y - 2, 2, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 1, y - 1, 1, 2);
    }
  }
}

// MISSILE power-up: homes in on the nearest enemy (or the boss).
export class Missile extends Bullet {
  constructor(x, y, side, owner) {
    super(x, y, side * 70, -110, owner);
    this.life = 2.5;
    this.target = null;
  }

  update(dt, g) {
    if ((this.life -= dt) <= 0) { this.dead = true; return; }
    if (!this.target || this.target.dead) this.target = this.findTarget(g);
    let a = Math.atan2(this.vy, this.vx);
    if (this.target) {
      let d = Math.atan2(this.target.y - this.y, this.target.x - this.x) - a;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a += clamp(d, -7 * dt, 7 * dt);
    }
    const sp = Math.min(230, Math.hypot(this.vx, this.vy) + 320 * dt);
    this.vx = Math.cos(a) * sp;
    this.vy = Math.sin(a) * sp;
    super.update(dt);
    if (Math.random() < 0.6) g.particles.push({ x: this.x, y: this.y, vx: 0, vy: 0, life: 0.2, c: '#9cff3a' });
  }

  findTarget(g) {
    let best = g.boss && g.boss.mode === 'fight' ? g.boss : null;
    let bd = best ? Math.hypot(best.x - this.x, best.y - this.y) : Infinity;
    for (const e of g.enemies) {
      if (e.dead || e.mode === 'wait') continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  draw(ctx) {
    ctx.fillStyle = '#9cff3a';
    ctx.fillRect(Math.round(this.x) - 1, Math.round(this.y) - 1, 2, 3);
  }
}

export class Enemy {
  // slot: formation slot from waves.js, or { type, minion: true } for
  // boss escorts and splitter children (they dive once, then leave)
  constructor(slot, path, delay) {
    Object.assign(this, {
      slot, path, delay, type: slot.type, hp: ENEMY_INFO[slot.type].hp,
      mode: 'wait', pi: 0, x: path[0][0], y: path[0][1], angle: Math.PI / 2,
      flash: 0, damaged: false, dead: false, beamT: 0, beamAge: 0, captive: 0,
    });
  }

  startDive(tx) {
    this.path = this.type === 'zig' ? zigPath(this, tx) : divePath(this, tx);
    this.pi = 0;
    this.mode = 'dive';
  }

  // Commanders only: fly down to x=tx and switch on the tractor beam.
  startBeam(tx) {
    const dir = this.x < W / 2 ? -1 : 1;
    this.path = sampleSpline([[this.x, this.y], [this.x + dir * 14, this.y - 12], [(this.x + tx) / 2, this.y + 50], [tx, BEAM_Y]]);
    this.pi = 0;
    this.mode = 'beamgo';
    this.beamT = 3.5;
  }

  update(dt, g) {
    this.flash = Math.max(0, this.flash - dt);
    const speed = g.d.speed;
    switch (this.mode) {
      case 'wait':
        if ((this.delay -= dt) <= 0) this.mode = this.slot.minion ? 'dive' : 'enter';
        break;
      case 'enter':
        if (followPath(this, speed * dt)) this.mode = 'home';
        this.maybeShoot(g, dt, g.wave > 1 ? 0.06 : 0);
        break;
      case 'home':
      case 'return': {
        const home = g.slotPos(this.slot);
        const dx = home.x - this.x, dy = home.y - this.y, d = Math.hypot(dx, dy), step = speed * dt;
        if (d <= step) { this.x = home.x; this.y = home.y; this.mode = 'form'; this.angle = Math.PI / 2; }
        else { this.x += (dx / d) * step; this.y += (dy / d) * step; this.angle = Math.atan2(dy, dx); }
        break;
      }
      case 'form': {
        const home = g.slotPos(this.slot);
        this.x = home.x;
        this.y = home.y;
        break;
      }
      case 'beamgo':
        if (followPath(this, speed * dt)) {
          this.mode = 'beam';
          this.angle = Math.PI / 2;
          this.beamAge = 0;
          sfx.tractor();
        }
        break;
      case 'beam': {
        this.beamAge += dt;
        this.beamT -= dt;
        if (this.beamAge > 0.4 && !g.players.some((p) => p.capture)) {
          const victim = g.alivePlayers().find((p) => p.canBeCaptured() && Math.abs(p.x - this.x) < 14);
          if (victim) victim.startCapture(this, g);
        }
        if (this.beamT <= 0) this.mode = 'return';
        break;
      }
      case 'dive':
        this.maybeShoot(g, dt, g.d.shootRate);
        if (followPath(this, speed * 1.1 * ENEMY_INFO[this.type].speed * dt)) {
          if (this.slot.minion) { this.dead = true; break; }
          const home = g.slotPos(this.slot);
          this.x = home.x;
          this.y = -16;
          this.mode = 'return';
        }
        break;
    }
  }

  maybeShoot(g, dt, rate) {
    if (this.type === 'mini' || this.mode === 'beam' || rate <= 0 || this.y < 24 || this.y > 190 || Math.random() > rate * dt) return;
    const t = g.targetPlayer();
    const a = clamp(Math.atan2(t.y - this.y, t.x - this.x), Math.PI * 0.25, Math.PI * 0.75);
    if (this.type === 'tank') {
      for (const k of [-0.25, 0, 0.25]) g.enemyShoot(this.x, this.y + 4, a + k, g.d.bulletSpeed * 0.85, k !== 0);
    } else {
      g.enemyShoot(this.x, this.y + 4, a, g.d.bulletSpeed);
    }
  }

  hit(dmg, g, by) {
    if (this.dead || this.mode === 'wait') return;
    this.hp -= dmg;
    if (this.hp > 0) {
      this.flash = 0.1;
      this.damaged = true;
      sfx.hit();
      return;
    }
    this.dead = true;
    const info = ENEMY_INFO[this.type];
    const diving = this.mode !== 'form';
    const pts = this.slot.minion ? info.pts[0] : info.pts[diving ? 1 : 0];
    if (by) {
      const got = g.kill(by, pts, this.x, this.y);
      g.fx(by, 'kill');
      if (diving && !this.slot.minion) g.popup(this.x, this.y, String(got));
    }
    // A captured ship is freed if its commander is shot while flying,
    // and lost for good if the commander is shot sitting in formation.
    if (this.captive) {
      if (this.mode === 'form') g.popup(this.x, this.y - 12, 'SHIP LOST', '#e8263a');
      else g.rescue(this.captive, this.x, this.y, by);
    }
    g.burst(this.x, this.y, info.color, 14);
    g.burst(this.x, this.y, '#ffffff', 6, 0.6);
    sfx.boom();
    if (this.type === 'split') this.splitUp(g);
    g.dropPowerup(this.x, this.y, this.type === 'cmdr' || this.type === 'tank' ? 0.3 : 0.06);
  }

  splitUp(g) {
    const tx = g.targetPlayer().x;
    for (const k of [-1, 1]) {
      const path = divePath({ x: this.x + k * 6, y: this.y }, tx + k * 22);
      g.enemies.push(new Enemy({ type: 'mini', minion: true }, path, 0));
    }
    sfx.split();
  }

  draw(ctx, g) {
    if (this.mode === 'wait') return;
    if (this.mode === 'beam') this.drawBeam(ctx, g);
    if (this.captive) {
      // the captured ship rides behind the commander, nose down
      const ox = this.x - Math.cos(this.angle) * 12, oy = this.y - Math.sin(this.angle) * 12;
      drawSprite(ctx, SPR.shipCaptive, ox, oy, this.angle + Math.PI / 2);
    }
    const frames = this.type === 'cmdr' && this.damaged ? SPR.cmdrHit : SPR[this.type];
    const img = this.flash > 0 ? SPR.flash[this.type] : frames[Math.floor(g.t * 2.5) % 2];
    drawSprite(ctx, img, this.x, this.y, this.angle - Math.PI / 2);
  }

  drawBeam(ctx, g) {
    const len = 110 * Math.min(1, this.beamAge * 2.5);
    const top = this.y + 7;
    const scroll = Math.floor(g.t * 40);
    for (let i = 0; i < len; i += 2) {
      const w = 4 + i * 0.16;
      ctx.fillStyle = (i + scroll) % 8 < 4 ? 'rgba(58, 224, 255, 0.55)' : 'rgba(42, 108, 255, 0.4)';
      ctx.fillRect(Math.round(this.x - w), Math.round(top + i), Math.round(w * 2), 1);
    }
  }
}

export class Boss {
  constructor(g) {
    this.n = Math.max(1, Math.floor(g.wave / 4));
    this.maxHp = 70 + this.n * 30;
    Object.assign(this, {
      hp: this.maxHp, x: W / 2, y: -40, mode: 'enter', t: 0,
      pattern: 0, patT: 5, fireT: 1, flash: 0, dead: false,
    });
  }

  get rage() { return this.hp < this.maxHp * 0.4; }

  collides(x, y) {
    return this.mode === 'fight' && Math.abs(x - this.x) < 28 && Math.abs(y - this.y) < 16;
  }

  update(dt, g) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    if (this.mode === 'enter') {
      this.y += 28 * dt;
      if (this.y >= 60) { this.y = 60; this.mode = 'fight'; this.t = 0; }
      return;
    }
    const rage = this.rage ? 1.5 : 1;
    this.x = W / 2 + Math.sin(this.t * 0.6 * rage) * 70;
    this.y = 60 + Math.sin(this.t * 1.3) * 10;
    if ((this.patT -= dt) <= 0) { this.pattern = (this.pattern + 1) % 3; this.patT = 5; this.fireT = 0.6; }
    if ((this.fireT -= dt * rage) > 0) return;
    const bs = g.d.bulletSpeed, ox = this.x, oy = this.y + 14;
    switch (this.pattern) {
      case 0: { // aimed fan
        const tgt = g.targetPlayer();
        const a = Math.atan2(tgt.y - oy, tgt.x - ox);
        for (let i = -2; i <= 2; i++) g.enemyShoot(ox, oy, a + i * 0.16, bs, true);
        this.fireT = 1.1;
        break;
      }
      case 1: { // ring
        const n = 12;
        for (let i = 0; i < n; i++) g.enemyShoot(ox, oy, this.t + (i * Math.PI * 2) / n, bs * 0.75, true);
        this.fireT = 1.0;
        break;
      }
      case 2: { // twin spiral
        for (const k of [0, Math.PI]) {
          const a = this.t * 3 + k;
          if (Math.sin(a) > -0.2) g.enemyShoot(ox, oy, a, bs * 0.8, true);
        }
        this.fireT = 0.12;
        break;
      }
    }
  }

  hit(dmg, g, by) {
    if (this.mode !== 'fight' || this.dead) return;
    this.hp -= dmg;
    this.flash = 0.05;
    if (by) g.addScore(by, 10);
    if (this.hp > 0) { sfx.hit(); return; }
    this.dead = true;
    const pts = 5000 * this.n;
    if (by) g.kill(by, pts, this.x, this.y);
    g.popup(this.x, this.y, String(pts), '#ffd23a');
    for (let i = 0; i < 6; i++) {
      g.burst(this.x + rand(-24, 24), this.y + rand(-12, 12), pick(['#e8263a', '#ffd23a', '#ffffff', '#b04aff']), 24, 1.4);
    }
    g.shake(14);
    g.flashT = 0.3;
    sfx.bigBoom();
    g.dropPowerup(this.x - 12, this.y, 1);
    g.dropPowerup(this.x + 12, this.y, 1);
    g.showBanner('BOSS DOWN', '#ffd23a', 2.5);
    g.players.forEach((p) => p.joined && g.fx(p.slot, 'win'));
  }

  draw(ctx, g) {
    const img = this.flash > 0 ? SPR.flash.boss : this.rage && Math.floor(g.t * 6) % 2 ? SPR.bossRage : SPR.boss;
    drawSprite(ctx, img, this.x, this.y, 0, 2);
  }
}

export class PowerUp {
  constructor(x, y, type) {
    Object.assign(this, { x, y, type, t: 0, dead: false });
  }

  update(dt) {
    this.t += dt;
    this.y += 42 * dt;
    this.x = clamp(this.x + Math.sin(this.t * 3) * 12 * dt, 8, W - 8);
    if (this.y > H + 10) this.dead = true;
  }

  apply(p, g) {
    const info = POWERS[this.type];
    switch (this.type) {
      case 'H': p.shield = SHIELD_TIME; break;
      case 'B': p.bombs = Math.min(3, p.bombs + 1); break;
      case 'D': p.twin = true; break;
      case 'T': g.slowT = SLOW_TIME; sfx.slow(); break;
      case 'X':
        p.lives = Math.min(6, p.lives + 1);
        sfx.extra();
        g.fx(p.slot, 'extra');
        break;
      default:
        // Same weapon again levels it up (max 3); a different one starts at 1.
        p.level = p.power === this.type ? Math.min(3, (p.level || 1) + 1) : 1;
        p.power = this.type;
        p.powerT = WEAPON_TIME[this.type];
    }
    sfx.power();
    g.fx(p.slot, 'power');
    const lv = WEAPON_TIME[this.type] && p.level > 1 ? ` LV${p.level}` : '';
    g.popup(this.x, this.y - 8, info.name + lv, info.color);
  }

  draw(ctx) {
    const { color, glyph } = POWERS[this.type];
    const x = Math.round(this.x) - 5, y = Math.round(this.y) - 5;
    ctx.fillStyle = Math.floor(this.t * 8) % 2 ? '#ffffff' : color;
    ctx.fillRect(x, y, 11, 11);
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, 9, 9);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.fillText(glyph || this.type, x + 2, y + 2);
  }
}
