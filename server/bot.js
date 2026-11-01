import { CONFIG } from './config.js';
import * as G from './geometry.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

function trailLength(trail, hx, hy) {
  let len = 0;
  for (let i = 1; i < trail.length; i++) len += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
  if (trail.length) len += Math.hypot(hx - trail[trail.length - 1].x, hy - trail[trail.length - 1].y);
  return len;
}

function crossesTrail(trail, ax, ay, bx, by, skipTail) {
  for (let i = 0; i < trail.length - 1 - skipTail; i++) {
    if (G.segmentsIntersect(ax, ay, bx, by, trail[i].x, trail[i].y, trail[i + 1].x, trail[i + 1].y)) return true;
  }
  return false;
}

// Behaviour mirrors the original's leaves: expand own zone, hunt enemy trails, flee home on threat.
export class BotBrain {
  constructor() {
    this.aggression = rand(0.15, 0.75);
    this.boldness = rand(0.6, 1.4);
    this.reactionDelay = rand(0.08, 0.22);
    this.reset();
  }

  reset() {
    this.state = 'home';
    this.waypoints = [];
    this.homeUntil = 0;
    this.thinkAt = 0;
    this.huntId = null;
    this.huntUntil = 0;
    this.target = null;
    this.exit = null;
    this.wobble = rand(0, TAU);
  }

  update(p, room, dt, now) {
    this.wobble += dt * rand(1.5, 3);
    if (now >= this.thinkAt) {
      this.thinkAt = now + this.reactionDelay * 1000;
      this.think(p, room, now);
    }
    if (!this.target) return;

    let angle = Math.atan2(this.target.y - p.y, this.target.x - p.x);
    angle += Math.sin(this.wobble) * 0.08;

    const dist = Math.hypot(p.x, p.y);
    if (dist > CONFIG.arenaRadius - 5) {
      const toCenter = Math.atan2(-p.y, -p.x);
      angle += G.angleDiff(angle, toCenter) * 0.6;
    }

    if (!p.inZone && p.trail.length > 6) {
      const lx = p.x + Math.cos(p.heading) * 3, ly = p.y + Math.sin(p.heading) * 3;
      if (crossesTrail(p.trail, p.x, p.y, lx, ly, 5)) {
        const side = G.angleDiff(p.heading, angle) >= 0 ? 1 : -1;
        angle = p.heading + side * Math.PI * 0.5;
      }
    }
    p.targetAngle = angle;
  }

  think(p, room, now) {
    if (p.inZone) {
      if (this.state !== 'home' && this.state !== 'hunt') {
        this.state = 'home';
        this.homeUntil = now + rand(100, 700);
        this.waypoints = [];
      }
      if (this.state === 'home') {
        if (this.tryHunt(p, room, now)) return;
        if (now >= this.homeUntil) this.planExpansion(p, room);
        else this.target = this.wanderInside(p);
        return;
      }
    } else if (this.state === 'home') {
      this.state = 'return';
    }

    if (this.state === 'hunt') {
      const prey = room.players.get(this.huntId);
      const len = trailLength(p.trail, p.x, p.y);
      if (!prey || !prey.alive || !prey.trail.length || now > this.huntUntil || len > 25 * this.boldness || this.threatened(p, room)) {
        this.state = p.inZone ? 'home' : 'return';
        this.homeUntil = now + rand(200, 800);
      } else {
        this.target = this.nearestTrailPoint(prey, p);
        return;
      }
    }

    if (this.state === 'expand') {
      const len = trailLength(p.trail, p.x, p.y);
      if (this.threatened(p, room) || len > 55 * this.boldness) {
        this.state = 'return';
      } else if (this.waypoints.length) {
        const wp = this.waypoints[0];
        if (Math.hypot(wp.x - p.x, wp.y - p.y) < 2.2) this.waypoints.shift();
        if (this.waypoints.length) {
          this.target = this.waypoints[0];
          return;
        }
        this.state = 'return';
      } else {
        this.state = 'return';
      }
    }

    if (this.state === 'return') this.target = this.homeTarget(p);
  }

  tryHunt(p, room, now) {
    if (Math.random() > this.aggression * 0.5) return false;
    const range = 8 + this.aggression * 14;
    let best = null;
    for (const q of room.players.values()) {
      if (q === p || !q.alive || !q.trail.length || now < q.invulnUntil) continue;
      const pt = this.nearestTrailPoint(q, p);
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < range && (!best || d < best.d)) best = { q, pt, d };
    }
    if (!best) return false;
    this.state = 'hunt';
    this.huntId = best.q.id;
    this.huntUntil = now + rand(2500, 4500);
    this.target = best.pt;
    return true;
  }

  threatened(p, room) {
    const danger = 5 + p.speed * 0.45 * (1.4 - this.aggression * 0.5);
    for (const q of room.players.values()) {
      if (q === p || !q.alive) continue;
      if (Math.hypot(q.x - p.x, q.y - p.y) < danger) return true;
      for (let i = 0; i < p.trail.length; i += 3) {
        if (Math.hypot(q.x - p.trail[i].x, q.y - p.trail[i].y) < danger * 0.8) return true;
      }
    }
    return false;
  }

  nearestTrailPoint(q, from) {
    let best = { x: q.x, y: q.y }, bd = Infinity;
    for (let i = 0; i < q.trail.length; i++) {
      const d = Math.hypot(q.trail[i].x - from.x, q.trail[i].y - from.y);
      if (d < bd) { bd = d; best = q.trail[i]; }
    }
    return best;
  }

  zoneCentroid(p) {
    const b = p.zone.bbox;
    if (!b) return p.spawnCenter;
    return { x: (b.minX + b.maxX) / 2 / G.SCALE, y: (b.minY + b.maxY) / 2 / G.SCALE };
  }

  wanderInside(p) {
    const c = this.zoneCentroid(p);
    const a = this.wobble * 0.7;
    const pt = { x: c.x + Math.cos(a) * 3, y: c.y + Math.sin(a) * 3 };
    return G.pointInZone(p.zone, pt.x, pt.y) ? pt : c;
  }

  planExpansion(p, room) {
    const c = this.zoneCentroid(p);
    const R = CONFIG.arenaRadius - 6;
    let outAngle = Math.atan2(p.y - c.y, p.x - c.x) + rand(-0.9, 0.9);
    if (Math.hypot(p.x - c.x, p.y - c.y) < 0.5) outAngle = rand(0, TAU);

    const depth = rand(6, 18) * this.boldness;
    const width = rand(6, 17) * this.boldness;
    const turn = Math.random() < 0.5 ? 1 : -1;
    const perp = outAngle + turn * Math.PI / 2;

    const clamp = (pt) => {
      const d = Math.hypot(pt.x, pt.y);
      return d > R ? { x: (pt.x * R) / d, y: (pt.y * R) / d } : pt;
    };
    const exit = { x: p.x, y: p.y };
    const wp1 = clamp({ x: exit.x + Math.cos(outAngle) * depth, y: exit.y + Math.sin(outAngle) * depth });
    const wp2 = clamp({ x: wp1.x + Math.cos(perp) * width, y: wp1.y + Math.sin(perp) * width });

    this.exit = exit;
    this.returnBias = { x: Math.cos(perp) * Math.min(width * 0.4, 3), y: Math.sin(perp) * Math.min(width * 0.4, 3) };
    this.waypoints = [wp1, wp2];
    this.state = 'expand';
    this.target = wp1;
  }

  homeTarget(p) {
    const c = this.zoneCentroid(p);
    const candidates = [];

    if (this.exit) {
      const ex = this.exit.x + this.returnBias.x, ey = this.exit.y + this.returnBias.y;
      const toC = Math.atan2(c.y - ey, c.x - ex);
      candidates.push({ x: ex + Math.cos(toC) * 2.5, y: ey + Math.sin(toC) * 2.5 });
    }

    const verts = [];
    for (const path of p.zone.paths) {
      const step = Math.max(1, Math.floor(path.length / 40));
      for (let i = 0; i < path.length; i += step) {
        const x = path[i].X / G.SCALE, y = path[i].Y / G.SCALE;
        verts.push({ x, y, d: Math.hypot(x - p.x, y - p.y) });
      }
    }
    verts.sort((a, b) => a.d - b.d);
    for (const v of verts.slice(0, 8)) {
      const toC = Math.atan2(c.y - v.y, c.x - v.x);
      candidates.push({ x: v.x + Math.cos(toC) * 1.5, y: v.y + Math.sin(toC) * 1.5 });
    }

    candidates.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    for (const cand of candidates) {
      if (!crossesTrail(p.trail, p.x, p.y, cand.x, cand.y, 4)) return cand;
    }
    return candidates[0] || c;
  }
}
