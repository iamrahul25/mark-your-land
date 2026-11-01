import { CONFIG, PALETTE, BOT_NAMES } from './config.js';
import * as G from './geometry.js';
import { BotBrain } from './bot.js';

let nextPlayerId = 1;

const round2 = (v) => Math.round(v * 100) / 100;

export class Room {
  constructor(id, io, isPrivate = false) {
    this.id = id;
    this.io = io;
    this.isPrivate = isPrivate;
    this.players = new Map();
    this.dirtyZones = new Set();
    this.arenaPath = G.circlePath(0, 0, CONFIG.arenaRadius, CONFIG.arenaSegments);
    this.arenaArea = G.pathsArea([this.arenaPath]);
    this.phase = 'countdown';
    this.phaseEndsAt = Date.now() + CONFIG.countdownSeconds * 1000;
    this.round = 1;

    // Fixed timestep: simulation time advances in exact steps regardless of timer jitter
    // (Windows timers have ~15.6 ms resolution), and snapshots carry simulation time.
    this.stepMs = 1000 / CONFIG.tickRate;
    this.simTime = Date.now();
    this.tickCount = 0;
    this.loopTimer = setInterval(() => this.runLoop(), 4);
  }

  destroy() {
    clearInterval(this.loopTimer);
  }

  runLoop() {
    const now = Date.now();
    if (now - this.simTime > 250) this.simTime = now - this.stepMs;
    while (this.simTime + this.stepMs <= now) {
      this.simTime += this.stepMs;
      this.tick(this.simTime);
      if (++this.tickCount % CONFIG.snapshotEveryTicks === 0) this.broadcastSnapshot(this.simTime);
    }
  }

  get humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  // ---------- membership ----------

  addHuman(socket, name, colorIndex) {
    const p = this.createPlayer(name, PALETTE[colorIndex % PALETTE.length], false);
    p.socket = socket;
    this.players.set(p.id, p);
    socket.join(this.id);
    this.ensureBots();
    if (this.phase !== 'results') this.spawn(p);
    this.broadcastRoster();

    const zones = {};
    for (const q of this.players.values()) zones[q.id] = G.zoneToWire(q.zone);
    socket.emit('welcome', {
      id: p.id,
      roomId: this.id,
      config: this.clientConfig(),
      roster: this.roster(),
      zones,
      phase: this.phase,
      round: this.round,
    });
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (p.socket) p.socket.leave(this.id);
    if (this.humanCount > 0) {
      this.ensureBots();
      this.broadcastRoster();
    }
  }

  createPlayer(name, color, isBot) {
    return {
      id: nextPlayerId++,
      name,
      color,
      isBot,
      socket: null,
      brain: isBot ? new BotBrain() : null,
      x: 0,
      y: 0,
      heading: 0,
      targetAngle: 0,
      speed: CONFIG.playerMoveSpeed,
      alive: false,
      inZone: true,
      trail: [],
      zone: G.EMPTY_ZONE,
      kills: 0,
      deaths: 0,
      respawnAt: 0,
      invulnUntil: 0,
      spawnCenter: { x: 0, y: 0 },
    };
  }

  ensureBots() {
    const desired = Math.max(0, Math.min(CONFIG.roomFill, CONFIG.maxPlayers) - this.humanCount);
    const bots = [...this.players.values()].filter((p) => p.isBot);
    while (bots.length > desired) {
      bots.sort((a, b) => Number(a.alive) - Number(b.alive) || a.zone.area - b.zone.area);
      const bot = bots.shift();
      this.players.delete(bot.id);
    }
    const usedNames = new Set([...this.players.values()].map((p) => p.name));
    for (let i = bots.length; i < desired; i++) {
      const pool = BOT_NAMES.filter((n) => !usedNames.has(n));
      const name = pool[Math.floor(Math.random() * pool.length)] || `Bot${nextPlayerId}`;
      usedNames.add(name);
      const bot = this.createPlayer(name, this.pickColor(), true);
      this.players.set(bot.id, bot);
      if (this.phase !== 'results') this.spawn(bot);
    }
  }

  pickColor() {
    const counts = new Map(PALETTE.map((c) => [c, 0]));
    for (const p of this.players.values()) counts.set(p.color, (counts.get(p.color) || 0) + 1);
    const min = Math.min(...counts.values());
    const options = PALETTE.filter((c) => counts.get(c) === min);
    return options[Math.floor(Math.random() * options.length)];
  }

  setInput(id, angle) {
    const p = this.players.get(id);
    if (p && !p.isBot && Number.isFinite(angle)) p.targetAngle = angle;
  }

  // ---------- match flow ----------

  tick(now = Date.now()) {
    const dt = this.stepMs / 1000;

    if (this.phase === 'countdown') {
      if (now >= this.phaseEndsAt) {
        this.phase = 'playing';
        this.phaseEndsAt = now + CONFIG.matchTimeSeconds * 1000;
      }
      return;
    }

    if (this.phase === 'results') {
      if (now >= this.phaseEndsAt) this.startRound();
      return;
    }

    for (const p of this.players.values()) {
      if (!p.alive && p.respawnAt && now >= p.respawnAt) this.spawn(p);
    }
    this.simulate(dt, now);
    if (now >= this.phaseEndsAt) this.endRound();
  }

  startRound() {
    this.round++;
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.zone = G.EMPTY_ZONE;
      p.trail = [];
      p.alive = false;
    }
    for (const p of this.players.values()) this.spawn(p);
    this.phase = 'countdown';
    this.phaseEndsAt = Date.now() + CONFIG.countdownSeconds * 1000;
    this.io.to(this.id).emit('roundStart', { round: this.round });
  }

  endRound() {
    this.phase = 'results';
    this.phaseEndsAt = Date.now() + CONFIG.resultsSeconds * 1000;
    const standings = [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, color: p.color, bot: p.isBot, area: this.areaPercent(p), kills: p.kills, deaths: p.deaths }))
      .sort((a, b) => b.area - a.area || b.kills - a.kills);
    for (const p of this.players.values()) {
      p.alive = false;
      p.trail = [];
    }
    this.io.to(this.id).emit('roundEnd', { round: this.round, standings, nextIn: CONFIG.resultsSeconds });
  }

  areaPercent(p) {
    return (p.zone.area / this.arenaArea) * 100;
  }

  // ---------- spawning ----------

  spawn(p) {
    const R = CONFIG.arenaRadius - CONFIG.initialZoneRadius - 3;
    const zr = CONFIG.initialZoneRadius + 1;
    const alive = [...this.players.values()].filter((q) => q.alive && q !== p);
    let best = null;

    for (let attempt = 0; attempt < 80; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * R;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;

      let overlap = 0;
      for (let k = 0; k <= 12; k++) {
        const sx = k === 12 ? x : x + Math.cos((k / 12) * Math.PI * 2) * zr;
        const sy = k === 12 ? y : y + Math.sin((k / 12) * Math.PI * 2) * zr;
        for (const q of this.players.values()) {
          if (q !== p && G.pointInZone(q.zone, sx, sy)) overlap++;
        }
      }
      let minDist = Infinity;
      for (const q of alive) minDist = Math.min(minDist, Math.hypot(q.x - x, q.y - y));
      for (const q of alive) {
        for (const t of q.trail) minDist = Math.min(minDist, Math.hypot(t.x - x, t.y - y) + 4);
      }
      const score = -overlap * 100 + Math.min(minDist, 60);
      if (!best || score > best.score) best = { x, y, score };
      if (overlap === 0 && minDist >= CONFIG.minPlayerSpawnDistance) break;
    }

    const now = Date.now();
    p.x = best.x;
    p.y = best.y;
    p.spawnCenter = { x: best.x, y: best.y };
    p.heading = Math.random() * Math.PI * 2;
    p.targetAngle = p.heading;
    p.speed = CONFIG.playerMoveSpeed;
    p.alive = true;
    p.inZone = true;
    p.trail = [];
    p.respawnAt = 0;
    p.invulnUntil = now + CONFIG.invulnerabilityTime * 1000;
    if (p.brain) p.brain.reset();

    const circle = [G.circlePath(best.x, best.y, CONFIG.initialZoneRadius, CONFIG.initialZonePoints)];
    p.zone = G.makeZone(G.intersection(circle, [this.arenaPath]));
    this.dirtyZones.add(p.id);
    this.carveFromOthers(p, p.zone.paths, null);
  }

  // ---------- simulation ----------

  simulate(dt, now) {
    const R = CONFIG.arenaRadius - 0.5;

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.brain) p.brain.update(p, this, dt, now);

      const diff = G.angleDiff(p.heading, p.targetAngle);
      const maxTurn = CONFIG.rotationSpeed * dt;
      p.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));

      const prevX = p.x, prevY = p.y;
      p.x += Math.cos(p.heading) * p.speed * dt;
      p.y += Math.sin(p.heading) * p.speed * dt;

      // The circular arena edge lets players slide along it (EdgeSlideEnabled in the original).
      const d = Math.hypot(p.x, p.y);
      if (d > R) {
        p.x *= R / d;
        p.y *= R / d;
      }

      p.inZone = G.pointInZone(p.zone, p.x, p.y);
      if (p.inZone) {
        if (p.trail.length) this.solidifyTrail(p);
      } else if (!p.trail.length) {
        p.trail.push({ x: prevX, y: prevY });
      } else {
        const last = p.trail[p.trail.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= CONFIG.trailPointSpacing) p.trail.push({ x: p.x, y: p.y });
      }
    }

    this.resolveCollisions(now);
  }

  solidifyTrail(p) {
    const loop = G.pointsToPath([...p.trail, { x: p.x, y: p.y }]);
    p.trail = [];
    let merged = G.fillHoles(G.union(p.zone.paths, [loop]));
    merged = G.intersection(merged, [this.arenaPath]);
    p.zone = G.makeZone(merged);
    this.dirtyZones.add(p.id);
    this.carveFromOthers(p, merged, p);
  }

  carveFromOthers(owner, paths, killer) {
    const cut = G.makeZone(paths);
    for (const q of this.players.values()) {
      if (q === owner || !G.bboxOverlap(q.zone.bbox, cut.bbox)) continue;
      q.zone = G.makeZone(G.difference(q.zone.paths, paths));
      this.dirtyZones.add(q.id);
      if (q.alive && q.zone.area < 0.5 && killer) this.kill(q, killer, 'land');
    }
  }

  hitsTrail(x, y, q, isSelf) {
    const t = q.trail;
    if (!t.length) return false;
    const r2 = CONFIG.trailHitRadius * CONFIG.trailHitRadius;
    let end = t.length - 1;

    if (isSelf) {
      let acc = Math.hypot(q.x - t[end].x, q.y - t[end].y);
      while (end > 0 && acc < CONFIG.selfTrailSkipLength) {
        acc += Math.hypot(t[end].x - t[end - 1].x, t[end].y - t[end - 1].y);
        end--;
      }
      if (acc < CONFIG.selfTrailSkipLength) return false;
    } else if (G.distToSegmentSq(x, y, t[end].x, t[end].y, q.x, q.y) < r2) {
      return true;
    }

    for (let i = 0; i < end; i++) {
      if (G.distToSegmentSq(x, y, t[i].x, t[i].y, t[i + 1].x, t[i + 1].y) < r2) return true;
    }
    return false;
  }

  resolveCollisions(now) {
    const victims = new Map();
    const list = [...this.players.values()].filter((p) => p.alive);
    const vulnerable = (p) => now >= p.invulnUntil;

    for (const p of list) {
      for (const q of list) {
        if (victims.has(q) || !q.trail.length || !vulnerable(q)) continue;
        const isSelf = p === q;
        if (isSelf && !CONFIG.selfTrailKills) continue;
        if (this.hitsTrail(p.x, p.y, q, isSelf)) victims.set(q, isSelf ? null : p);
      }
    }

    const headR = CONFIG.headRadius * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) > headR) continue;
        if (!a.inZone && !b.inZone) {
          if (vulnerable(a) && !victims.has(a)) victims.set(a, b);
          if (vulnerable(b) && !victims.has(b)) victims.set(b, a);
        } else if (a.inZone && !b.inZone && vulnerable(b) && !victims.has(b)) {
          victims.set(b, a);
        } else if (b.inZone && !a.inZone && vulnerable(a) && !victims.has(a)) {
          victims.set(a, b);
        }
      }
    }

    for (const [victim, killer] of victims) this.kill(victim, killer, killer ? 'trail' : 'self');
  }

  kill(victim, killer, reason) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.trail = [];
    victim.deaths++;
    victim.respawnAt = Date.now() + CONFIG.respawnTimeSeconds * 1000;

    if (killer && killer !== victim) {
      killer.kills++;
      killer.speed = Math.min(CONFIG.maxPlayerSpeed, killer.speed + CONFIG.speedIncreaseOnKill);
      if (CONFIG.stealZoneOnKill && killer.alive && victim.zone.paths.length) {
        const merged = G.fillHoles(G.union(killer.zone.paths, victim.zone.paths));
        killer.zone = G.makeZone(merged);
        this.dirtyZones.add(killer.id);
      }
    }
    victim.zone = G.EMPTY_ZONE;
    this.dirtyZones.add(victim.id);

    this.io.to(this.id).emit('feed', {
      type: 'kill',
      victim: victim.id,
      killer: killer && killer !== victim ? killer.id : null,
      reason,
      respawnIn: CONFIG.respawnTimeSeconds,
    });
  }

  // ---------- networking ----------

  clientConfig() {
    return {
      arenaRadius: CONFIG.arenaRadius,
      headRadius: CONFIG.headRadius,
      scale: G.SCALE,
      respawnTimeSeconds: CONFIG.respawnTimeSeconds,
      matchTimeSeconds: CONFIG.matchTimeSeconds,
      snapshotRate: CONFIG.tickRate / CONFIG.snapshotEveryTicks,
    };
  }

  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, bot: p.isBot }));
  }

  broadcastRoster() {
    this.io.to(this.id).emit('roster', this.roster());
  }

  broadcastSnapshot(now = Date.now()) {
    const players = [];
    for (const p of this.players.values()) {
      let trail = 0;
      if (p.alive && p.trail.length) {
        trail = new Array(p.trail.length * 2);
        for (let i = 0; i < p.trail.length; i++) {
          trail[i * 2] = round2(p.trail[i].x);
          trail[i * 2 + 1] = round2(p.trail[i].y);
        }
      }
      players.push({
        i: p.id,
        x: Math.round(p.x * 100) / 100,
        y: Math.round(p.y * 100) / 100,
        h: Math.round(p.heading * 1000) / 1000,
        s: (p.alive ? 1 : 0) | (now < p.invulnUntil ? 2 : 0),
        a: Math.round(this.areaPercent(p) * 100) / 100,
        k: p.kills,
        tr: trail,
      });
    }

    const snap = { t: now, ph: this.phase, te: Math.max(0, this.phaseEndsAt - now), p: players };
    if (this.dirtyZones.size) {
      snap.z = {};
      for (const id of this.dirtyZones) {
        const p = this.players.get(id);
        if (p) snap.z[id] = G.zoneToWire(p.zone);
      }
      this.dirtyZones.clear();
    }
    this.io.to(this.id).emit('snap', snap);
  }
}
