import { CONFIG } from './config.js';
import { Room } from './room.js';

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.publicCounter = 1;
  }

  pick(code) {
    if (code) {
      const id = `room-${code}`;
      let room = this.rooms.get(id);
      if (room && room.humanCount >= CONFIG.maxPlayers) return null;
      if (!room) {
        room = new Room(id, this.io, true);
        this.rooms.set(id, room);
      }
      return room;
    }

    let best = null;
    for (const room of this.rooms.values()) {
      if (room.isPrivate || room.humanCount >= CONFIG.maxPlayers) continue;
      if (!best || room.humanCount > best.humanCount) best = room;
    }
    if (best) return best;

    const id = `public-${this.publicCounter++}`;
    const room = new Room(id, this.io, false);
    this.rooms.set(id, room);
    return room;
  }

  leave(room, playerId) {
    room.removePlayer(playerId);
    if (room.humanCount === 0) {
      room.destroy();
      this.rooms.delete(room.id);
    }
  }

  list() {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      code: r.isPrivate ? r.id.slice(5) : null,
      humans: r.humanCount,
      total: r.players.size,
      phase: r.phase,
    }));
  }
}
