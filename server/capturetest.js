import assert from 'node:assert';
import { CONFIG } from './config.js';
import { Room } from './room.js';

CONFIG.roomFill = 0;
const io = { to: () => ({ emit() {} }) };
const socket = { join() {}, leave() {}, emit() {} };

function setup() {
  const room = new Room('t', io);
  room.destroy();
  room.phase = 'playing';
  room.phaseEndsAt = Date.now() + 1e9;
  return room;
}

function drive(room, p, plan) {
  const dt = 1 / CONFIG.tickRate;
  let now = Date.now() + 5000;
  for (const [angle, seconds] of plan) {
    for (let t = 0; t < seconds; t += dt) {
      p.targetAngle = angle;
      room.simulate(dt, (now += dt * 1000));
    }
  }
}

// 1. A square loop out of the spawn zone and back captures land.
{
  const room = setup();
  const p = room.addHuman(socket, 'A', 0);
  p.heading = 0;
  const before = room.areaPercent(p);
  drive(room, p, [[0, 1.2], [Math.PI / 2, 1.0], [Math.PI, 1.2], [-Math.PI / 2, 0.8]]);
  const after = room.areaPercent(p);
  console.log(`capture: ${before.toFixed(2)}% -> ${after.toFixed(2)}%, alive=${p.alive}, trail=${p.trail.length}`);
  assert(p.alive && after > before * 1.5 && p.trail.length === 0);
}

// 2. Crossing another player's trail kills that player and credits the killer.
{
  const room = setup();
  const a = room.addHuman(socket, 'A', 0);
  const b = room.addHuman(socket, 'B', 1);
  for (const p of [a, b]) p.invulnUntil = 0;
  a.trail = [{ x: 0, y: -10 }, { x: 0, y: 10 }];
  a.x = 0; a.y = 10; a.inZone = false;
  a.zone = { ...a.zone };
  b.x = -3; b.y = 0; b.heading = 0; b.targetAngle = 0; b.inZone = false; b.trail = [{ x: -4, y: 0 }];
  room.resolveCollisions(Date.now());
  b.x = 0.2;
  room.resolveCollisions(Date.now());
  console.log(`trail kill: A alive=${a.alive}, B kills=${b.kills}`);
  assert(!a.alive && b.kills === 1);
}

// 3. Enclosing another player's land removes it from them.
{
  const room = setup();
  const a = room.addHuman(socket, 'A', 0);
  const b = room.addHuman(socket, 'B', 1);
  const areaB = room.areaPercent(b);
  a.trail = [];
  for (let i = 0; i <= 40; i++) {
    const ang = (i / 40) * Math.PI * 2;
    a.trail.push({ x: b.x + Math.cos(ang) * 9, y: b.y + Math.sin(ang) * 9 });
  }
  a.trail.push({ x: a.x, y: a.y });
  room.solidifyTrail(a);
  console.log(`steal: B ${areaB.toFixed(2)}% -> ${room.areaPercent(b).toFixed(2)}%, B alive=${b.alive}`);
  assert(room.areaPercent(b) < 0.01 && !b.alive);
}

console.log('All capture tests passed.');
process.exit(0);
