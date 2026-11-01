import express from 'express';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { CONFIG, PALETTE } from './config.js';
import { RoomManager } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new RoomManager(io);

app.use('/api', (_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});
app.get('/api/rooms', (_req, res) => res.json({ rooms: rooms.list(), palette: PALETTE }));
app.get('/healthz', (_req, res) => res.send('ok'));
if (fs.existsSync(distDir)) app.use(express.static(distDir));

const sanitizeName = (v) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) : '') || 'Player';
const sanitizeCode = (v) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) : '');

io.on('connection', (socket) => {
  let room = null;
  let playerId = null;

  socket.on('join', (data = {}) => {
    if (room) rooms.leave(room, playerId);
    const target = rooms.pick(sanitizeCode(data.room));
    if (!target) {
      socket.emit('joinError', { message: 'That room is full.' });
      return;
    }
    const colorIndex = Number.isInteger(data.color) && data.color >= 0 ? data.color : Math.floor(Math.random() * PALETTE.length);
    room = target;
    playerId = room.addHuman(socket, sanitizeName(data.name), colorIndex).id;
  });

  socket.on('input', (data) => {
    if (room && data && typeof data.a === 'number') room.setInput(playerId, data.a);
  });

  socket.on('leave', () => {
    if (room) rooms.leave(room, playerId);
    room = null;
  });

  socket.on('disconnect', () => {
    if (room) rooms.leave(room, playerId);
    room = null;
  });
});

server.listen(CONFIG.port, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${CONFIG.port}`);
  console.log(`Game server listening on http://localhost:${CONFIG.port}`);
  if (lan.length) console.log(`LAN: ${lan.join('  ')}`);
  if (!fs.existsSync(distDir)) console.log('Client not built: use the Vite dev server (npm run dev) or run npm run build.');
});
