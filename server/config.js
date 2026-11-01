// Field names mirror the original's RuntimeConfig / MatchSettings; values are tuned for the web.
export const CONFIG = {
  port: Number(process.env.PORT) || 3001,

  tickRate: 60,
  snapshotEveryTicks: 2,

  arenaRadius: 90,
  arenaSegments: 120,

  playerMoveSpeed: 11,
  speedIncreaseOnKill: 0.4,
  maxPlayerSpeed: 14,
  rotationSpeed: Math.PI * 1.7,

  headRadius: 0.95,
  trailHitRadius: 0.65,
  trailPointSpacing: 0.45,
  selfTrailSkipLength: 3.2,
  selfTrailKills: true,

  initialZoneRadius: 5.5,
  initialZonePoints: 36,

  countdownSeconds: 3,
  matchTimeSeconds: 180,
  respawnTimeSeconds: 3,
  invulnerabilityTime: 2,
  resultsSeconds: 10,
  stealZoneOnKill: false,

  maxPlayers: 10,
  roomFill: 8,
  minPlayerSpawnDistance: 20,
};

export const PALETTE = [
  '#ff5a5f', '#ffb400', '#00b3a4', '#7b61ff', '#2ba8ff',
  '#ff6fb1', '#4cc94c', '#ff8a3d', '#2f5fde', '#b45cff',
  '#00c2d8', '#e0c200',
];

export const BOT_NAMES = [
  'Pixel', 'Nova', 'Zippy', 'Mango', 'Rex', 'Luna', 'Bolt', 'Kiwi', 'Echo',
  'Taco', 'Blitz', 'Juno', 'Sprout', 'Comet', 'Waffle', 'Ziggy', 'Orbit',
  'Pebble', 'Dash', 'Mochi', 'Fizz', 'Rocket', 'Nacho', 'Bean',
];
