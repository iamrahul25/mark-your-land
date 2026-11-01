import { io } from 'socket.io-client';

const url = process.argv[2] || 'http://localhost:3001';
const socket = io(url, { transports: ['websocket'] });
const samples = [];
const arrivals = [];
let prev = null;

socket.on('connect', () => socket.emit('join', { name: 'Probe', color: 0, room: `jitter-${Date.now()}` }));
socket.on('snap', (s) => {
  arrivals.push(performance.now());
  if (s.ph === 'playing' && prev) {
    const dt = (s.t - prev.t) / 1000;
    const before = new Map(prev.p.map((p) => [p.i, p]));
    for (const p of s.p) {
      const q = before.get(p.i);
      if (q && p.s & 1 && q.s & 1 && dt > 0) samples.push(Math.hypot(p.x - q.x, p.y - q.y) / dt);
    }
  }
  prev = s;
});

setTimeout(() => {
  const speeds = samples.filter((v) => v > 1 && v < 40).sort((a, b) => a - b);
  const pct = (q) => speeds[Math.floor(q * (speeds.length - 1))].toFixed(2);
  const gaps = arrivals.slice(1).map((t, i) => t - arrivals[i]);
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const sd = Math.sqrt(speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length);
  console.log(`apparent speed (true speed 11-14): p5 ${pct(0.05)}  median ${pct(0.5)}  p95 ${pct(0.95)}  stddev ${sd.toFixed(2)}`);
  console.log(`arrival gap ms: min ${Math.min(...gaps).toFixed(1)}  max ${Math.max(...gaps).toFixed(1)}`);
  socket.disconnect();
  process.exit(0);
}, 7000);
