import React, { useState } from 'react';
import Lobby from './Lobby.jsx';
import GameView from './GameView.jsx';

export default function App() {
  const [session, setSession] = useState(null);

  if (!session) return <Lobby onPlay={setSession} />;
  return <GameView session={session} onExit={() => setSession(null)} />;
}
