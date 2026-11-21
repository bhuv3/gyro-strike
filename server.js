// Gyro Strike server: serves the game + controller pages and relays
// phone input to the game screen over WebSockets.
//
//   http://localhost:9080/game/        game screen on this computer (no cert warning)
//   https://<LAN-IP>:9443/controller/  phones (HTTPS is required for tilt sensors)

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import selfsigned from 'selfsigned';
import QRCode from 'qrcode';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const HTTP_PORT = Number(process.env.PORT || 9080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 9443);
const IP = process.env.HOST_IP || lanIp();

function lanIp() {
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) found.push({ name, address: a.address });
    }
  }
  const best = found.find((f) => /^(en0|en1|wlan|wlp|eth)/.test(f.name)) || found[0];
  return best ? best.address : '127.0.0.1';
}

// Self-signed cert, cached so phones only have to accept the warning once.
// Regenerated when the LAN IP changes.
async function loadCert() {
  const dir = path.join(ROOT, '.cert');
  const files = { key: path.join(dir, 'key.pem'), cert: path.join(dir, 'cert.pem'), ip: path.join(dir, 'ip.txt') };
  if (fs.existsSync(files.key) && fs.existsSync(files.cert) && fs.existsSync(files.ip) &&
      fs.readFileSync(files.ip, 'utf8') === IP) {
    return { key: fs.readFileSync(files.key), cert: fs.readFileSync(files.cert) };
  }
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 2);
  const pems = await selfsigned.generate([{ name: 'commonName', value: IP }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: notAfter,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: IP },
      ] },
    ],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(files.key, pems.private);
  fs.writeFileSync(files.cert, pems.cert);
  fs.writeFileSync(files.ip, IP);
  return { key: pems.private, cert: pems.cert };
}

// ---------- static files ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function serve(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (p === '/') { res.writeHead(302, { Location: '/game/' }); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { res.writeHead(302, { Location: p + '/' }); return res.end(); }
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- rooms ----------
// A room has one host (the game screen) and up to two players (phones).
// Host messages carrying `s` (slot 1|2) are relayed to that phone; phone
// messages are relayed to the host with `s` filled in.

const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
// Where phones should go to join. A game screen opened through a tunnel or
// public hostname shares that address; opened locally or by LAN IP, phones
// use the LAN HTTPS address. PUBLIC_URL overrides both.
function joinOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const hostname = host.replace(/:\d+$/, '');
  if (!hostname || /^(localhost|127\.|\[::1\])/.test(hostname) || hostname === IP) return `https://${IP}:${HTTPS_PORT}`;
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0];
  return `${proto}://${host}`;
}

const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function newCode() {
  let code;
  do code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
  while (rooms.has(code));
  return code;
}

async function becomeHost(ws, m) {
  const wanted = typeof m.code === 'string' && /^[A-Z]{4}$/.test(m.code) ? m.code : null;
  let room = wanted && rooms.get(wanted);
  if (room && room.host) room = null; // code in use by another open game screen
  if (!room) {
    const code = wanted && !rooms.has(wanted) ? wanted : newCode();
    room = { code, host: null, players: [null, null], expire: null };
    rooms.set(code, room);
  }
  clearTimeout(room.expire);
  room.host = ws;
  ws.role = 'host';
  ws.code = room.code;
  const joinUrl = `${ws.origin}/controller/?room=${room.code}`;
  const qr = await QRCode.toDataURL(joinUrl, { margin: 1, scale: 6, color: { dark: '#000', light: '#fff' } });
  send(ws, { t: 'room', code: room.code, joinUrl, qr, players: room.players.map(Boolean) });
  room.players.forEach((p) => send(p, { t: 'hostback' }));
}

function joinRoom(ws, m) {
  const code = String(m.code || '').toUpperCase();
  const room = rooms.get(code);
  if (!room) return send(ws, { t: 'err', m: `NO GAME WITH CODE ${code || '?'}` });
  const id = String(m.id || '');
  // Same phone reconnecting before its old socket timed out: take its slot back.
  for (const [i, p] of room.players.entries()) {
    if (p && id && p.clientId === id) { room.players[i] = null; p.terminate(); }
  }
  let slot = [1, 2].includes(m.slot) && !room.players[m.slot - 1] ? m.slot : 0;
  if (!slot) slot = !room.players[0] ? 1 : !room.players[1] ? 2 : 0;
  if (!slot) return send(ws, { t: 'err', m: 'GAME IS FULL (2 PLAYERS)' });
  Object.assign(ws, { role: 'player', code, slot, clientId: id });
  room.players[slot - 1] = ws;
  send(ws, { t: 'joined', s: slot, host: !!room.host });
  send(room.host, { t: 'pj', s: slot, on: true });
}

function leave(ws) {
  const room = rooms.get(ws.code);
  if (!room) return;
  if (ws.role === 'host' && room.host === ws) {
    room.host = null;
    room.players.forEach((p) => send(p, { t: 'hostgone' }));
    // Keep the room briefly so a reloaded game screen gets the same code back.
    room.expire = setTimeout(() => {
      if (room.host) return;
      rooms.delete(room.code);
      room.players.forEach((p) => p && p.close());
    }, 120_000);
  } else if (ws.role === 'player' && room.players[ws.slot - 1] === ws) {
    room.players[ws.slot - 1] = null;
    send(room.host, { t: 'pj', s: ws.slot, on: false });
  }
}

function onConnection(ws, req) {
  ws.origin = joinOrigin(req);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (!ws.role) {
      if (m.t === 'host') becomeHost(ws, m).catch((e) => console.error(e));
      else if (m.t === 'join') joinRoom(ws, m);
      return;
    }
    const room = rooms.get(ws.code);
    if (!room) return;
    if (ws.role === 'host') {
      if (m.s === 1 || m.s === 2) send(room.players[m.s - 1], m);
    } else {
      m.s = ws.slot;
      send(room.host, m);
    }
  });
  ws.on('close', () => leave(ws));
}

function attachWs(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
  wss.on('connection', onConnection);
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 5000);
  wss.on('close', () => clearInterval(beat));
}

// ---------- start ----------

const httpServer = http.createServer(serve);
const httpsServer = https.createServer(await loadCert(), serve);
attachWs(httpServer);
attachWs(httpsServer);
httpServer.listen(HTTP_PORT, () => {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`
  GYRO STRIKE is running

  Game screen (open on this computer):  http://localhost:${HTTP_PORT}/game/
  Game screen (from another device):    https://${IP}:${HTTPS_PORT}/game/
  Phones join at:                       https://${IP}:${HTTPS_PORT}/controller/

  Phones must be on the same Wi-Fi. Accept the certificate warning once
  (it's a self-signed cert so the tilt sensors are allowed).
${process.env.PUBLIC_URL ? `
  PUBLIC (any network):                 ${process.env.PUBLIC_URL.replace(/\/$/, '')}/game/
  QR codes point here, so players can join from anywhere.
` : ''}`);
  });
});
