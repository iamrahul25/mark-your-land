import { io } from 'socket.io-client';

const url = process.argv[2] || 'http://localhost:3001';
const socket = io(url, { transports: ['websocket'] });

socket.on('connect', () => socket.emit('join', { name: 'Second', color: 3 }));
socket.on('welcome', async (w) => {
  const humans = w.roster.filter((p) => !p.bot).map((p) => p.name);
  console.log(`Joined ${w.roomId} as #${w.id}; humans in room: ${humans.join(', ')}; total players: ${w.roster.length}`);
  let snaps = 0;
  socket.on('snap', () => snaps++);
  await new Promise((r) => setTimeout(r, 1000));
  console.log(`Received ${snaps} snapshots in 1s`);
  const rooms = await (await fetch(`${url}/api/rooms`)).json();
  console.log('Rooms:', JSON.stringify(rooms.rooms));
  socket.disconnect();
  process.exit(0);
});
setTimeout(() => {
  console.error('Timed out');
  process.exit(1);
}, 5000);
