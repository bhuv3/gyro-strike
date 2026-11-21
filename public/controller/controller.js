// Phone controller: reads tilt, fire/bomb buttons and shakes, sends them to
// the game screen over WebSocket, and plays haptics for game events.

const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const clientId = store.get('gs-id', null) || Math.random().toString(36).slice(2, 10);
store.set('gs-id', clientId);
const settings = {
  mode: 'tilt', sens: 22, invX: false, invY: false, vert: true, haptic: true, sound: true, flick: true,
  ...store.get('gs-settings', {}),
};

let code = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
let ws = null;
let slot = 0;
let started = false;
let hostUp = false;
const input = { x: 0, y: 0, f: false };

// ---------- connection ----------

function setStatus(text, cls = '') {
  $('status').textContent = text;
  $('status').className = cls;
}

function send(m) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  setStatus('CONNECTING');
  ws.onopen = () => send({ t: 'join', code, slot: slot || store.get(`gs-slot-${code}`, 0), id: clientId });
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    handle(m);
  };
  ws.onclose = () => {
    setStatus('RECONNECTING', 'warn');
    setTimeout(connect, 1500);
  };
}

function handle(m) {
  switch (m.t) {
    case 'joined':
      slot = m.s;
      hostUp = m.host;
      store.set(`gs-slot-${code}`, slot);
      $('who').textContent = `${slot}UP`;
      document.body.classList.toggle('p2', slot === 2);
      $('err').textContent = '';
      setStatus(hostUp ? 'CONNECTED' : 'GAME SCREEN OFFLINE', hostUp ? 'ok' : 'warn');
      break;
    case 'hostgone':
      hostUp = false;
      setStatus('GAME SCREEN OFFLINE', 'warn');
      break;
    case 'hostback':
      hostUp = true;
      setStatus('CONNECTED', 'ok');
      break;
    case 'err':
      setStatus(m.m, 'warn');
      $('err').textContent = m.m;
      ws.close(); // onclose retries
      break;
    case 'fx':
      haptic(m.k);
      playSound(m.k, m.v);
      showAlert(m.k);
      break;
    case 'st':
      showStats(m);
      break;
    case 'ask':
      askInitials(m.score);
      break;
    case 'pong': {
      const ms = performance.now() - m.c;
      rtt = Math.round(rtt ? rtt * 0.6 + ms * 0.4 : ms);
      $('ping').textContent = `${rtt}MS`;
      $('ping').className = rtt < 60 ? 'ok' : rtt < 150 ? 'warn' : 'bad';
      break;
    }
    case 'askdone':
      $('initials').hidden = true;
      break;
  }
}

function showStats(st) {
  let hint = 'HOLD TO SHOOT';
  if (st.state === 'attract') hint = 'PRESS TO START';
  else if (st.state === 'play' && !st.joined) hint = 'PRESS TO JOIN';
  else if (st.out || st.state === 'gameover') hint = 'GAME OVER';
  else if (st.state === 'scores') hint = 'PRESS TO CONTINUE';
  $('hint').textContent = hint;
  $('stats').textContent = st.joined
    ? `${st.mult > 1 ? `x${st.mult} ` : ''}${st.score}  ♥${st.lives}  B${st.bombs}` +
      `${st.power ? ` ${st.power}${st.level}` : ''}${st.shield ? ' H' : ''}${st.twin ? ' D' : ''}`
    : '';
}

// ---------- tilt ----------
// deviceorientation beta/gamma give the "up" direction in device coordinates.
// We rotate that into screen coordinates so it works in portrait or landscape,
// then read roll (left/right) and pitch (forward/back) relative to a
// calibrated rest position.

let roll = 0, pitch = 0;
let cal = { roll: 0, pitch: 0 };
let needCal = true;
let lastSensor = 0;
let manual = null; // {x, y} while dragging on the pad (joystick mode or tilt fallback)
let stickOrigin = null;
const STICK_RADIUS = 50; // px of thumb travel for full speed

function screenAngle() {
  const a = screen.orientation?.angle ?? window.orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

addEventListener('deviceorientation', (e) => {
  if (e.beta == null || e.gamma == null) return;
  lastSensor = performance.now();
  const b = e.beta * D2R, gm = e.gamma * D2R;
  const dx = -Math.sin(gm) * Math.cos(b);
  const dy = Math.sin(b);
  const a = screenAngle() * D2R;
  const sx = dx * Math.cos(a) - dy * Math.sin(a);
  const sy = dx * Math.sin(a) + dy * Math.cos(a);
  const r = Math.asin(clamp(-sx, -1, 1)) / D2R;
  const p = Math.asin(clamp(sy, -1, 1)) / D2R;
  roll += (r - roll) * 0.5;
  pitch += (p - pitch) * 0.5;
  if (needCal && started) recenter();
  detectFlick();
  sendInput();
});

// Flick to roll: the phone's roll angle jumps by FLICK_DEG within FLICK_MS.
// Normal steering is much slower than that.
const FLICK_DEG = 28;
const FLICK_MS = 150;
const rollHist = [];
let lastFlick = 0;
function detectFlick() {
  const now = performance.now();
  rollHist.push([now, roll]);
  while (now - rollHist[0][0] > FLICK_MS) rollHist.shift();
  const delta = roll - rollHist[0][1];
  if (!settings.flick || !started || Math.abs(delta) < FLICK_DEG || now - lastFlick < 900) return;
  lastFlick = now;
  rollHist.length = 0;
  sendRoll(Math.sign(delta) * (settings.invX ? -1 : 1));
}

function sendRoll(d) {
  if (started) send({ t: 'roll', d });
}

function recenter() {
  cal = { roll, pitch };
  needCal = false;
}

function axis(deg) {
  const dead = 2.5;
  const mag = Math.abs(deg);
  if (mag < dead) return 0;
  return Math.sign(deg) * clamp((mag - dead) / (settings.sens - dead), 0, 1);
}

const stickMode = () => settings.mode === 'stick';

function computeInput() {
  if (manual) {
    input.x = manual.x;
    input.y = settings.vert || stickMode() ? manual.y : 0;
  } else if (stickMode()) {
    input.x = 0;
    input.y = 0;
  } else {
    input.x = axis(roll - cal.roll) * (settings.invX ? -1 : 1);
    input.y = settings.vert ? axis(cal.pitch - pitch) * (settings.invY ? -1 : 1) : 0;
  }
  const r = tilt.getBoundingClientRect();
  $('dot').style.transform = `translate(${input.x * (r.width / 2 - 14)}px, ${-input.y * (r.height / 2 - 14)}px)`;
}

const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch { /* synthetic event */ } };

// The pad: in joystick mode a floating stick (centered where your thumb
// lands); in tilt mode an absolute drag fallback for phones without sensors.
const tilt = $('tilt');
function dragTo(e) {
  if (stickOrigin) {
    let dx = (e.clientX - stickOrigin.x) / STICK_RADIUS;
    let dy = -(e.clientY - stickOrigin.y) / STICK_RADIUS;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    manual = { x: Math.abs(dx) < 0.08 ? 0 : dx, y: Math.abs(dy) < 0.08 ? 0 : dy };
    return;
  }
  const r = tilt.getBoundingClientRect();
  manual = {
    x: clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1),
    y: clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -1, 1),
  };
}
// Stick mode: double-tap the pad to roll toward the side you last steered.
let lastPadTap = 0;
let lastStickDir = 1;
tilt.addEventListener('pointerdown', (e) => {
  capture(tilt, e);
  stickOrigin = stickMode() ? { x: e.clientX, y: e.clientY } : null;
  const now = performance.now();
  if (stickMode() && now - lastPadTap < 300) sendRoll(lastStickDir);
  lastPadTap = now;
  dragTo(e);
});
tilt.addEventListener('pointermove', (e) => {
  if (!manual) return;
  dragTo(e);
  if (manual.x) lastStickDir = Math.sign(manual.x);
  sendInput();
});
['pointerup', 'pointercancel'].forEach((t) => tilt.addEventListener(t, () => { manual = null; stickOrigin = null; sendInput(true); }));

// ---------- control mode ----------

function applyMode() {
  document.body.classList.toggle('stick', stickMode());
  $('mode').textContent = stickMode() ? 'STICK' : 'TILT';
  $('padlbl').textContent = stickMode() ? 'DRAG TO MOVE / DOUBLE-TAP TO ROLL' : '';
}

$('mode').addEventListener('click', () => {
  settings.mode = stickMode() ? 'tilt' : 'stick';
  store.set('gs-settings', settings);
  applyMode();
  if (!stickMode()) { askMotion(); needCal = true; }
  else if (hostUp && slot) setStatus('CONNECTED', 'ok'); // drop any tilt-sensor warning
});

// iOS: motion permission must be requested straight from a tap.
function askMotion() {
  const asks = [];
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') asks.push(DeviceOrientationEvent.requestPermission());
  if (typeof DeviceMotionEvent?.requestPermission === 'function') asks.push(DeviceMotionEvent.requestPermission());
  return Promise.allSettled(asks).then((rs) => rs.some((r) => r.status === 'rejected' || r.value === 'denied'));
}
applyMode();

// ---------- buttons ----------

const fire = $('fire');
let tapped = false; // a press shorter than one send tick still gets sent once
fire.addEventListener('pointerdown', (e) => {
  capture(fire, e);
  unlockSound();
  input.f = true;
  tapped = true;
  fire.classList.add('on');
  sendInput(true);
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => fire.addEventListener(t, () => {
  input.f = false;
  fire.classList.remove('on');
  sendInput(true);
}));

let lastBomb = 0;
function sendBomb() {
  const now = performance.now();
  if (!started || now - lastBomb < 1000) return;
  lastBomb = now;
  send({ t: 'bomb' });
  $('bomb').classList.add('on');
  setTimeout(() => $('bomb').classList.remove('on'), 200);
}
$('bomb').addEventListener('pointerdown', sendBomb);
$('recenter').addEventListener('click', () => { recenter(); haptic('tick'); });

// Shake = bomb.
addEventListener('devicemotion', (e) => {
  const a = e.acceleration;
  let mag;
  if (a && a.x != null) mag = Math.hypot(a.x, a.y, a.z);
  else if (e.accelerationIncludingGravity?.x != null) {
    const g = e.accelerationIncludingGravity;
    mag = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
  }
  if (mag > 22) sendBomb();
});

// Volume-up = bomb, on the rare browsers that pass hardware keys to the page.
addEventListener('keydown', (e) => {
  if (e.key === 'AudioVolumeUp' || e.code === 'AudioVolumeUp' || e.keyCode === 175) {
    e.preventDefault();
    sendBomb();
  }
});

// ---------- haptics ----------

const PATTERNS = {
  kill: [40], hit: [150], dead: [300, 80, 300], power: [50, 40, 50], bomb: [80, 40, 160],
  extra: [50, 50, 50, 50, 200], boss: [400], win: [80, 60, 80, 60, 300], tick: [30],
  capture: [120, 60, 120, 60, 120, 60, 120, 60, 120, 60, 120], escape: [40, 40, 40], lost: [600],
  rescue: [60, 40, 60, 40, 60, 40, 300], roll: [25], combo: [30, 30, 30],
};
const FLASH = {
  hit: '#e8263a', dead: '#e8263a', power: '#3ae0ff', bomb: '#ff8a1e', extra: '#2fd06a', boss: '#e8263a',
  win: '#ffd23a', capture: '#2a6cff', escape: '#2fd06a', lost: '#e8263a', rescue: '#2fd06a', combo: '#ffd23a',
};

function haptic(k) {
  if (settings.haptic && navigator.vibrate) navigator.vibrate(PATTERNS[k] || 40);
  const c = FLASH[k];
  if (!c) return;
  const f = $('flash');
  f.style.background = c;
  f.classList.add('show');
  requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('show')));
}

// Big centered message while a tractor beam has you.
let alertTimer = 0;
function showAlert(k) {
  const el = $('alert');
  clearTimeout(alertTimer);
  if (k === 'capture') {
    el.textContent = 'SHAKE!';
    el.hidden = false;
    alertTimer = setTimeout(() => { el.hidden = true; }, 2500);
  } else if (k === 'escape' || k === 'lost' || k === 'dead') {
    el.hidden = true;
  }
}

// ---------- phone sounds ----------
// Each phone plays its own player's events, so in co-op you hear your sounds.

let actx = null;
function unlockSound() {
  if (!settings.sound) return;
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { /* no WebAudio */ }
}

function beep(f0, f1, dur, { type = 'square', vol = 0.12, delay = 0 } = {}) {
  const t = actx.currentTime + delay;
  const o = actx.createOscillator();
  const gn = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  gn.gain.setValueAtTime(vol, t);
  gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(gn).connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hiss(dur, { vol = 0.2, f0 = 3000, f1 = 200, delay = 0 } = {}) {
  const t = actx.currentTime + delay;
  const buf = actx.createBuffer(1, Math.ceil(actx.sampleRate * dur), actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource();
  src.buffer = buf;
  const flt = actx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const gn = actx.createGain();
  gn.gain.setValueAtTime(vol, t);
  gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(flt).connect(gn).connect(actx.destination);
  src.start(t);
}

const notes = (fs, step, opts) => fs.forEach((f, i) => beep(f, f, step * 0.9, { ...opts, delay: i * step }));

const SOUNDS = {
  kill: () => beep(900, 250, 0.07, { vol: 0.06 }),
  hit: () => hiss(0.2, { vol: 0.25, f0: 4000, f1: 400 }),
  dead: () => { hiss(0.8, { vol: 0.3 }); beep(500, 40, 0.8, { type: 'sawtooth', vol: 0.12 }); },
  power: () => notes([523, 659, 784, 1047], 0.06),
  bomb: () => { hiss(1, { vol: 0.35, f0: 900, f1: 40 }); beep(120, 25, 1, { type: 'sawtooth', vol: 0.15 }); },
  extra: () => notes([784, 988, 1175, 1568], 0.08),
  boss: () => notes([880, 660, 880, 660], 0.2, { type: 'sawtooth', vol: 0.06 }),
  win: () => notes([523, 659, 784, 1047, 1319], 0.08),
  capture: () => { for (let i = 0; i < 8; i++) beep(i % 2 ? 300 : 460, i % 2 ? 460 : 300, 0.2, { type: 'sine', vol: 0.15, delay: i * 0.2 }); },
  escape: () => notes([392, 523, 784], 0.07),
  lost: () => notes([784, 659, 523, 392, 330], 0.12, { type: 'triangle', vol: 0.15 }),
  rescue: () => notes([523, 659, 784, 1047, 1319, 1568], 0.08),
  roll: () => hiss(0.25, { vol: 0.18, f0: 6000, f1: 700 }),
  combo: (m = 2) => beep(500 + m * 180, 500 + m * 180, 0.12, { vol: 0.1 }),
  tick: () => beep(880, 880, 0.04, { vol: 0.05 }),
};

function playSound(k, v) {
  if (!settings.sound || !actx || actx.state !== 'running') return;
  try { SOUNDS[k]?.(v); } catch { /* ignore */ }
}

// ---------- high score initials ----------

function askInitials(score) {
  $('hsscore').textContent = `SCORE ${score}`;
  $('hsin').value = '';
  $('initials').hidden = false;
  $('hsin').focus();
}

$('hsform').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('hsin').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (!v) return;
  send({ t: 'initials', v });
  $('initials').hidden = true;
  $('hsin').blur();
});

// ---------- settings ----------

function applySettings() {
  $('sens').value = settings.sens;
  $('sensv').textContent = `${settings.sens}°`;
  $('invx').checked = settings.invX;
  $('invy').checked = settings.invY;
  $('vert').checked = settings.vert;
  $('haptic').checked = settings.haptic;
  $('sound').checked = settings.sound;
  $('flick').checked = settings.flick;
}
applySettings();

$('gear').addEventListener('click', () => { $('settings').hidden = false; });
$('close').addEventListener('click', () => { $('settings').hidden = true; });
$('settings').addEventListener('input', () => {
  Object.assign(settings, {
    sens: +$('sens').value, invX: $('invx').checked, invY: $('invy').checked,
    vert: $('vert').checked, haptic: $('haptic').checked,
    sound: $('sound').checked, flick: $('flick').checked,
  });
  unlockSound();
  store.set('gs-settings', settings);
  applySettings();
});

// ---------- start ----------

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && started) keepAwake();
});

if (!code) $('codebox').hidden = false;
if (!window.isSecureContext) {
  $('err').textContent = 'Open this page over https:// or tilt will not work.';
}

$('start').addEventListener('click', async () => {
  if (!code) {
    const v = $('codein').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(v)) { $('err').textContent = 'Enter the 4-letter room code'; return; }
    code = v;
    history.replaceState(null, '', `?room=${code}`);
    connect();
  }
  unlockSound();
  // Motion is still needed in joystick mode for shake-to-bomb.
  const denied = await askMotion();

  // Not awaited: some browsers never settle these promises.
  Promise.resolve(document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }))
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
  keepAwake();

  started = true;
  needCal = true;
  $('overlay').hidden = true;
  if (denied && !stickMode()) setStatus('MOTION BLOCKED - TRY STICK MODE', 'warn');
  setTimeout(() => {
    if (!lastSensor && hostUp && !stickMode()) setStatus('NO TILT SENSOR - TRY STICK MODE', 'warn');
  }, 2500);
});

if (code) connect();

// Input goes out as soon as it changes (sensor event, drag, button), at most
// every MIN_GAP ms, plus a keepalive. Over Wi-Fi a socket can stall for a
// moment; anything queued behind the stall arrives late all at once, so while
// the socket still has unsent bytes we skip the send and only the newest
// input goes out once it drains.
const MIN_GAP = 16;
const KEEPALIVE = 100;
let lastSent = '', lastSentAt = 0, skipped = false;
function sendInput(force = false) {
  computeInput();
  if (!started || !slot || !ws || ws.readyState !== 1) return;
  const now = performance.now();
  const f = input.f || tapped;
  const key = `${input.x.toFixed(3)},${input.y.toFixed(3)},${f ? 1 : 0}`;
  if (!force && !skipped && key === lastSent && now - lastSentAt < KEEPALIVE) return;
  if (!force && now - lastSentAt < MIN_GAP) { skipped = true; return; }
  if (ws.bufferedAmount > 0 && !(force && tapped)) { skipped = true; return; }
  ws.send(JSON.stringify({ t: 'in', x: +input.x.toFixed(3), y: +input.y.toFixed(3), f }));
  lastSent = key;
  lastSentAt = now;
  skipped = false;
  tapped = false;
}
setInterval(sendInput, 16);

// Round trip to the game screen, shown in the status bar and on the game
// screen's player list.
let rtt = 0;
setInterval(() => {
  if (started && slot && hostUp) send({ t: 'ping', c: performance.now(), rtt });
}, 1000);

$('vibtest').addEventListener('click', () => {
  const ok = typeof navigator.vibrate === 'function' && navigator.vibrate([300, 100, 300]);
  $('vibinfo').textContent = ok
    ? 'NO BUZZ? TURN ON TOUCH FEEDBACK IN ANDROID SETTINGS'
    : 'THIS BROWSER CANNOT VIBRATE (IPHONE?)';
});
