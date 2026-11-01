import React from 'react';

const fmtTime = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const nameOf = (client, id) => client.roster.get(id)?.name || 'someone';

export default function Hud({ client, state, onExit }) {
  const players = state.players.filter((p) => p.info);
  const ranked = [...players].sort((a, b) => b.area - a.area || b.kills - a.kills);
  const me = players.find((p) => p.id === client.me);
  const myRank = ranked.findIndex((p) => p.id === client.me) + 1;
  const now = Date.now();

  const death = client.myDeath;
  const showDeath = state.phase === 'playing' && me && !me.alive && death;
  const respawnLeft = death ? Math.max(0, death.respawnIn - (now - death.at) / 1000) : 0;

  return (
    <>
      <div className="hud-top-left">
        {me && (
          <div className="stat-card">
            <div className="stat-big" style={{ color: me.info.color }}>
              {me.area.toFixed(2)}%
            </div>
            <div className="stat-small">
              Rank #{myRank} of {players.length} · {me.kills} kill{me.kills === 1 ? '' : 's'}
            </div>
          </div>
        )}
        <button className="exit-btn" onClick={onExit}>
          Leave
        </button>
      </div>

      <div className="hud-timer">
        {state.phase === 'playing' && <span>{fmtTime(state.timeLeft)}</span>}
        <div className="room-tag">{client.roomId?.startsWith('room-') ? `Room "${client.roomId.slice(5)}"` : client.roomId}</div>
      </div>

      <div className="leaderboard">
        {ranked.slice(0, 6).map((p, i) => (
          <div key={p.id} className={`lb-row ${p.id === client.me ? 'me' : ''}`}>
            <span className="lb-rank">{i + 1}</span>
            <span className="lb-dot" style={{ background: p.info.color }} />
            <span className="lb-name">{p.info.name}</span>
            <span className="lb-area">{p.area.toFixed(1)}%</span>
          </div>
        ))}
        {myRank > 6 && me && (
          <div className="lb-row me">
            <span className="lb-rank">{myRank}</span>
            <span className="lb-dot" style={{ background: me.info.color }} />
            <span className="lb-name">{me.info.name}</span>
            <span className="lb-area">{me.area.toFixed(1)}%</span>
          </div>
        )}
      </div>

      <div className="feed">
        {client.feed
          .filter((f) => now - f.at < 5000)
          .map((f) => (
            <div key={f.at + '-' + f.victim} className="feed-row">
              {f.killer ? (
                <>
                  <b style={{ color: client.roster.get(f.killer)?.color }}>{nameOf(client, f.killer)}</b>
                  {f.reason === 'land' ? ' swallowed ' : ' eliminated '}
                  <b style={{ color: client.roster.get(f.victim)?.color }}>{nameOf(client, f.victim)}</b>
                </>
              ) : (
                <>
                  <b style={{ color: client.roster.get(f.victim)?.color }}>{nameOf(client, f.victim)}</b> crossed their own trail
                </>
              )}
            </div>
          ))}
      </div>

      {state.phase === 'countdown' && (
        <div className="countdown">
          <div className="countdown-num">{Math.max(1, Math.ceil(state.timeLeft / 1000))}</div>
          <div className="countdown-label">Get ready</div>
        </div>
      )}

      {showDeath && (
        <div className="overlay soft">
          <div className="panel">
            <h2>
              {death.killer
                ? death.reason === 'land'
                  ? `${nameOf(client, death.killer)} took all your land`
                  : `Eliminated by ${nameOf(client, death.killer)}`
                : 'You crossed your own trail'}
            </h2>
            <p>Respawning in {Math.ceil(respawnLeft)}…</p>
          </div>
        </div>
      )}

      {client.results && state.phase === 'results' && (
        <div className="overlay">
          <div className="panel results">
            <h2>Round over</h2>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Land</th>
                  <th>Kills</th>
                </tr>
              </thead>
              <tbody>
                {client.results.standings.map((s, i) => (
                  <tr key={s.id} className={s.id === client.me ? 'me' : ''}>
                    <td>{i === 0 ? '👑' : i + 1}</td>
                    <td>
                      <span className="lb-dot" style={{ background: s.color }} /> {s.name}
                      {s.bot && <span className="bot-tag">bot</span>}
                    </td>
                    <td>{s.area.toFixed(2)}%</td>
                    <td>{s.kills}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>Next round in {Math.ceil(state.timeLeft / 1000)}s</p>
          </div>
        </div>
      )}
    </>
  );
}
