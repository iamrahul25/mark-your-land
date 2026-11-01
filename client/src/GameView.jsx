import React, { useEffect, useRef, useState } from 'react';
import { GameClient } from './game/net.js';
import { Renderer } from './game/renderer.js';
import { attachInput } from './game/input.js';
import Hud from './Hud.jsx';

export default function GameView({ session, onExit }) {
  const canvasRef = useRef(null);
  const [client, setClient] = useState(null);
  const [hud, setHud] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const c = new GameClient(session);
    const renderer = new Renderer(canvasRef.current);
    renderer.resize();
    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);

    const detachInput = attachInput(canvasRef.current, (a) => c.sendInput(a));
    c.on('error', setError);
    setClient(c);

    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const state = c.config ? c.sample() : null;
      if (state) renderer.draw(c, state, dt);
      if (state && now - lastHud > 150) {
        lastHud = now;
        setHud({ state, at: Date.now() });
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      detachInput();
      c.destroy();
    };
  }, [session]);

  return (
    <div className="game">
      <canvas ref={canvasRef} className="game-canvas" />
      {client && hud && <Hud client={client} state={hud.state} onExit={onExit} />}
      {!hud && !error && <div className="center-msg">Connecting…</div>}
      {error && (
        <div className="overlay">
          <div className="panel">
            <h2>{error}</h2>
            <button className="play-btn" onClick={onExit}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
