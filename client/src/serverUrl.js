// Empty in dev, where Vite proxies /api and /socket.io to the local server.
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
