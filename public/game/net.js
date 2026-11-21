// Game-screen side of the WebSocket link. Creates (or reclaims) a room and
// forwards every server message to the game.

const CODE_KEY = 'gyro-strike-room';

export class Net {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      let code = null;
      try { code = sessionStorage.getItem(CODE_KEY); } catch { /* ignore */ }
      this.send({ t: 'host', code });
    };
    this.ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'room') {
        try { sessionStorage.setItem(CODE_KEY, m.code); } catch { /* ignore */ }
      }
      this.onMessage(m);
    };
    this.ws.onclose = () => {
      this.onMessage({ t: 'offline' });
      setTimeout(() => this.connect(), 1500);
    };
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}
