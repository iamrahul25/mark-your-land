import { io } from 'socket.io-client';

const INTERP_DELAY = 90;
const MAX_EXTRAPOLATE = 80;
const OFFSET_WINDOW = 2000;

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function buildZone(rings, scale) {
  const path = new Path2D();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const flat of rings) {
    for (let i = 0; i < flat.length; i += 2) {
      const x = flat[i] / scale, y = flat[i + 1] / scale;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    path.closePath();
  }
  return { path, empty: rings.length === 0, bbox: { minX, minY, maxX, maxY } };
}

export class GameClient {
  constructor({ name, color, room }) {
    this.listeners = new Map();
    this.snaps = [];
    this.pendingZones = [];
    this.zones = new Map();
    this.roster = new Map();
    this.feed = [];
    this.me = null;
    this.config = null;
    this.offsetSamples = [];
    this.offset = null;
    this.renderT = null;
    this.lastSampleAt = 0;
    this.results = null;
    this.myDeath = null;
    this.lastSentAngle = null;
    this.lastSentAt = 0;
    this.connected = false;

    this.socket = io({ transports: ['websocket'] });
    this.socket.on('connect', () => {
      this.connected = true;
      this.socket.emit('join', { name, color, room });
    });
    this.socket.on('disconnect', () => {
      this.connected = false;
      this.emit('status', 'disconnected');
    });
    this.socket.on('joinError', (e) => this.emit('error', e.message));
    this.socket.on('welcome', (w) => this.onWelcome(w));
    this.socket.on('snap', (s) => this.onSnap(s));
    this.socket.on('roster', (r) => this.setRoster(r));
    this.socket.on('feed', (f) => this.onFeed(f));
    this.socket.on('roundEnd', (r) => {
      this.results = r;
      this.emit('results', r);
    });
    this.socket.on('roundStart', () => {
      this.results = null;
      this.myDeath = null;
      this.feed = [];
      this.emit('results', null);
    });
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) || []) fn(payload);
  }

  destroy() {
    this.socket.emit('leave');
    this.socket.disconnect();
    this.listeners.clear();
  }

  onWelcome(w) {
    this.me = w.id;
    this.roomId = w.roomId;
    this.config = w.config;
    this.setRoster(w.roster);
    this.zones.clear();
    for (const [id, rings] of Object.entries(w.zones)) this.zones.set(Number(id), buildZone(rings, w.config.scale));
    this.emit('welcome', w);
  }

  setRoster(list) {
    this.roster = new Map(list.map((p) => [p.id, p]));
    for (const id of this.zones.keys()) if (!this.roster.has(id)) this.zones.delete(id);
  }

  // The smallest (local arrival - server time) over a short window is the least-delayed
  // packet, so it is a stable clock offset that ignores per-packet network jitter.
  onSnap(s) {
    const now = performance.now();
    this.offsetSamples.push({ at: now, off: now - s.t });
    while (this.offsetSamples.length && this.offsetSamples[0].at < now - OFFSET_WINDOW) this.offsetSamples.shift();
    let min = Infinity;
    for (const o of this.offsetSamples) if (o.off < min) min = o.off;
    this.offset = min;
    this.snaps.push(s);
    if (s.z) this.pendingZones.push({ t: s.t, z: s.z });
    while (this.snaps.length > 2 && this.snaps[1].t < s.t - 1000) this.snaps.shift();
  }

  onFeed(f) {
    const entry = { ...f, at: Date.now() };
    this.feed.push(entry);
    if (this.feed.length > 6) this.feed.shift();
    if (f.victim === this.me) this.myDeath = entry;
  }

  sendInput(angle) {
    const now = performance.now();
    if (!this.connected || now - this.lastSentAt < 40) return;
    if (this.lastSentAngle != null && Math.abs(angle - this.lastSentAngle) < 0.005) return;
    this.lastSentAngle = angle;
    this.lastSentAt = now;
    this.socket.emit('input', { a: angle });
  }

  // Interpolated world state at "now - INTERP_DELAY" in server time.
  sample() {
    if (!this.snaps.length || this.offset == null) return null;

    // Advance the render clock by real frame time and only nudge it toward the target,
    // so offset updates never make positions jump.
    const now = performance.now();
    const target = now - this.offset - INTERP_DELAY;
    if (this.renderT == null || Math.abs(target - this.renderT) > 250) {
      this.renderT = target;
    } else {
      const frame = now - this.lastSampleAt;
      this.renderT += frame + (target - this.renderT) * Math.min(1, frame / 1000);
    }
    this.lastSampleAt = now;
    const renderT = this.renderT;

    while (this.pendingZones.length && this.pendingZones[0].t <= renderT) {
      const { z } = this.pendingZones.shift();
      for (const [id, rings] of Object.entries(z)) {
        const pid = Number(id);
        if (this.roster.has(pid)) this.zones.set(pid, buildZone(rings, this.config.scale));
      }
    }

    const snaps = this.snaps;
    let a = snaps[0], b = snaps[0];
    if (snaps.length > 1) {
      a = snaps[snaps.length - 2];
      b = snaps[snaps.length - 1];
      for (let i = 0; i < snaps.length - 1; i++) {
        if (snaps[i + 1].t >= renderT) {
          a = snaps[i];
          b = snaps[i + 1];
          break;
        }
      }
    }
    // Past the newest snapshot (late packet): extrapolate briefly instead of freezing.
    const maxT = b.t === a.t ? 0 : 1 + MAX_EXTRAPOLATE / (b.t - a.t);
    const t = b.t === a.t ? 0 : Math.min(maxT, Math.max(0, (renderT - a.t) / (b.t - a.t)));

    const bById = new Map(b.p.map((p) => [p.i, p]));
    const players = [];
    for (const pa of a.p) {
      const pb = bById.get(pa.i);
      const aliveA = pa.s & 1, aliveB = pb ? pb.s & 1 : 0;
      let x = pa.x, y = pa.y, h = pa.h;
      if (pb && aliveA && aliveB) {
        x = pa.x + (pb.x - pa.x) * t;
        y = pa.y + (pb.y - pa.y) * t;
        h = lerpAngle(pa.h, pb.h, t);
      }
      players.push({
        id: pa.i,
        x,
        y,
        h,
        alive: !!aliveA,
        invuln: !!(pa.s & 2),
        area: pa.a,
        kills: pa.k,
        trail: pa.tr || null,
        info: this.roster.get(pa.i),
      });
    }
    return { players, phase: b.ph, timeLeft: Math.max(0, b.te - (renderT - b.t)), latest: this.snaps[this.snaps.length - 1] };
  }
}
