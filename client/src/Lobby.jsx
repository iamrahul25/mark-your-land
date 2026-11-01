import React, { useEffect, useState } from 'react';

const FALLBACK_PALETTE = ['#ff5a5f', '#ffb400', '#00b3a4', '#7b61ff', '#2ba8ff', '#ff6fb1', '#4cc94c', '#ff8a3d', '#2f5fde', '#b45cff', '#00c2d8', '#e0c200'];

export default function Lobby({ onPlay }) {
  const params = new URLSearchParams(window.location.search);
  const [name, setName] = useState(() => localStorage.getItem('claimr.name') || '');
  const [color, setColor] = useState(() => Number(localStorage.getItem('claimr.color') || 0));
  const [room, setRoom] = useState(params.get('room') || '');
  const [palette, setPalette] = useState(FALLBACK_PALETTE);
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/rooms')
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          setRooms(d.rooms);
          if (d.palette) setPalette(d.palette);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const play = (roomCode = room) => {
    const finalName = name.trim() || `Player${Math.floor(Math.random() * 900 + 100)}`;
    localStorage.setItem('claimr.name', finalName);
    localStorage.setItem('claimr.color', String(color));
    const code = roomCode.trim().toLowerCase();
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    window.history.replaceState(null, '', url);
    onPlay({ name: finalName, color, room: code });
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1 className="logo">
          Claimr<span>.io</span>
        </h1>
        <p className="tagline">Leave your land, draw a loop, get back home to claim it.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            play();
          }}
        >
          <input className="name-input" placeholder="Your name" maxLength={16} value={name} onChange={(e) => setName(e.target.value)} autoFocus />

          <div className="swatches">
            {palette.map((c, i) => (
              <button
                type="button"
                key={c}
                className={`swatch ${i === color ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(i)}
                aria-label={`Color ${i + 1}`}
              />
            ))}
          </div>

          <input
            className="room-input"
            placeholder="Room code (optional, share it with friends)"
            maxLength={20}
            value={room}
            onChange={(e) => setRoom(e.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
          />

          <button className="play-btn" type="submit">
            {room ? `Play in room "${room.toLowerCase()}"` : 'Play'}
          </button>
        </form>

        {rooms.length > 0 && (
          <div className="room-list">
            <div className="room-list-title">Live rooms</div>
            {rooms.map((r) => (
              <button key={r.id} className="room-row" onClick={() => play(r.code || '')}>
                <span>{r.code ? `Room "${r.code}"` : r.id.replace('public-', 'Public #')}</span>
                <span className="muted">
                  {r.humans} human{r.humans === 1 ? '' : 's'} · {r.total} players
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="help">
          <b>Steer</b> with the mouse, touch-drag, or WASD / arrow keys. Cross an opponent's trail to eliminate them, and never let
          anyone touch yours. The biggest territory when the timer ends wins.
        </div>
      </div>
    </div>
  );
}
