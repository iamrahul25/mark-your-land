import { CONFIG } from './config.js';
import { Room } from './room.js';

const seconds = Number(process.argv[2]) || 40;
CONFIG.countdownSeconds = 0.2;
CONFIG.matchTimeSeconds = seconds;

const counts = { snap: 0, kill: 0, roundEnd: 0, bytes: 0 };
const io = {
  to: () => ({
    emit: (event, payload) => {
      if (event === 'snap') {
        counts.snap++;
        counts.bytes += JSON.stringify(payload).length;
      }
      if (event === 'feed') counts.kill++;
      if (event === 'roundEnd') {
        counts.roundEnd++;
        console.log('Round end standings:');
        for (const s of payload.standings) console.log(`  ${s.name.padEnd(8)} area ${s.area.toFixed(2)}%  kills ${s.kills}  deaths ${s.deaths}`);
      }
    },
  }),
};

const fakeSocket = { join() {}, leave() {}, emit() {} };
const room = new Room('sim', io);
room.addHuman(fakeSocket, 'Idle', 0);

const started = Date.now();
let maxTick = 0;
const origTick = room.tick.bind(room);
room.tick = () => {
  const t0 = performance.now();
  try {
    origTick();
  } catch (err) {
    console.error('Tick threw:', err);
    process.exit(1);
  }
  const ms = performance.now() - t0;
  maxTick = Math.max(maxTick, ms);
  totalTick += ms;
  ticks++;
};
let totalTick = 0, ticks = 0;

setTimeout(() => {
  room.destroy();
  const elapsed = (Date.now() - started) / 1000;
  console.log(`\nSimulated ${elapsed.toFixed(1)}s, kills ${counts.kill}, rounds ended ${counts.roundEnd}`);
  console.log(`Max tick ${maxTick.toFixed(2)} ms, avg tick ${(totalTick / ticks).toFixed(3)} ms, avg snapshot ${(counts.bytes / counts.snap / 1024).toFixed(1)} KB`);
  process.exit(counts.roundEnd >= 1 ? 0 : 1);
}, (seconds + 1) * 1000);
