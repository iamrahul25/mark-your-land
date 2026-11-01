const shadeCache = new Map();

export function shade(hex, factor) {
  const key = hex + factor;
  if (shadeCache.has(key)) return shadeCache.get(key);
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(factor < 1 ? c * factor : c + (255 - c) * (factor - 1));
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  const out = `rgb(${r},${g},${b})`;
  shadeCache.set(key, out);
  return out;
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Quadratic curves through segment midpoints, using each recorded point as the control point,
// so the polyline renders as a continuous curve that still ends exactly at the head.
function traceSmooth(ctx, flat, hx, hy) {
  const n = flat.length / 2;
  const x = (i) => (i < n ? flat[i * 2] : hx);
  const y = (i) => (i < n ? flat[i * 2 + 1] : hy);
  const count = n + 1;
  ctx.moveTo(x(0), y(0));
  if (count === 2) {
    ctx.lineTo(hx, hy);
    return;
  }
  for (let i = 1; i < count - 1; i++) {
    ctx.quadraticCurveTo(x(i), y(i), (x(i) + x(i + 1)) / 2, (y(i) + y(i + 1)) / 2);
  }
  ctx.lineTo(hx, hy);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.camInit = false;
    this.gridPattern = null;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  draw(client, state, dt) {
    const { ctx, dpr, w, h } = this;
    const R = client.config.arenaRadius;
    const me = state.players.find((p) => p.id === client.me);

    if (me && me.alive) {
      if (!this.camInit) {
        this.cam.x = me.x;
        this.cam.y = me.y;
        this.camInit = true;
      }
      const k = 1 - Math.exp(-dt * 12);
      this.cam.x += (me.x - this.cam.x) * k;
      this.cam.y += (me.y - this.cam.y) * k;
    }
    const myArea = me ? me.area : 0;
    const targetZoom = Math.min(w, h) / (40 + Math.min(myArea, 30) * 0.6);
    this.cam.zoom += (targetZoom - this.cam.zoom) * (1 - Math.exp(-dt * 3));
    const s = this.cam.zoom;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#b8c6dc';
    ctx.fillRect(0, 0, w, h);

    const toWorld = () => ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (w / 2 - this.cam.x * s), dpr * (h / 2 - this.cam.y * s));
    toWorld();

    // Arena floor
    ctx.beginPath();
    ctx.arc(0, 0.8, R, 0, Math.PI * 2);
    ctx.fillStyle = '#93a5c2';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = '#eef2f8';
    ctx.fill();

    ctx.save();
    ctx.clip();
    this.drawGrid(ctx, s);

    const viewL = this.cam.x - w / 2 / s - 2, viewR = this.cam.x + w / 2 / s + 2;
    const viewT = this.cam.y - h / 2 / s - 2, viewB = this.cam.y + h / 2 / s + 2;
    const visible = (b) => b && b.maxX >= viewL && b.minX <= viewR && b.maxY >= viewT && b.minY <= viewB;

    // Territories: a darker copy offset downward gives the tiles a little depth.
    for (const [id, zone] of client.zones) {
      const info = client.roster.get(id);
      if (!info || zone.empty || !visible(zone.bbox)) continue;
      ctx.save();
      ctx.translate(0, 0.55);
      ctx.fillStyle = shade(info.color, 0.68);
      ctx.fill(zone.path, 'evenodd');
      ctx.restore();
    }
    for (const [id, zone] of client.zones) {
      const info = client.roster.get(id);
      if (!info || zone.empty || !visible(zone.bbox)) continue;
      ctx.fillStyle = info.color;
      ctx.fill(zone.path, 'evenodd');
      ctx.strokeStyle = shade(info.color, 1.25);
      ctx.lineWidth = 0.25;
      ctx.stroke(zone.path);
    }

    // Trails
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of state.players) {
      if (!p.alive || !p.trail || !p.info) continue;
      ctx.beginPath();
      traceSmooth(ctx, p.trail, p.x, p.y);
      ctx.strokeStyle = rgba(p.info.color, 0.55);
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
    ctx.restore();

    // Arena rim
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#7d8fb0';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // Players
    const now = performance.now();
    for (const p of state.players) {
      if (p.alive && p.info) this.drawPlayer(ctx, p, client.config.headRadius, now);
    }

    // Name tags in screen space for crisp text
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 13px Fredoka, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of state.players) {
      if (!p.alive || !p.info) continue;
      const sx = w / 2 + (p.x - this.cam.x) * s, sy = h / 2 + (p.y - this.cam.y) * s - client.config.headRadius * s - 10;
      if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(30,40,60,0.55)';
      ctx.strokeText(p.info.name, sx, sy);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.info.name, sx, sy);
    }

    this.drawMinimap(client, state);
  }

  drawGrid(ctx, s) {
    const step = 4;
    const R = 100;
    ctx.beginPath();
    for (let x = -R; x <= R; x += step) {
      ctx.moveTo(x, -R);
      ctx.lineTo(x, R);
      ctx.moveTo(-R, x);
      ctx.lineTo(R, x);
    }
    ctx.strokeStyle = 'rgba(120,140,180,0.13)';
    ctx.lineWidth = Math.max(0.06, 1 / s);
    ctx.stroke();
  }

  drawPlayer(ctx, p, r, now) {
    const color = p.info.color;
    ctx.save();
    ctx.translate(p.x, p.y);

    if (p.invuln) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.45 + Math.sin(now / 120) * 0.12), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 0.18;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.ellipse(0, r * 0.55, r * 0.95, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,30,50,0.18)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0.22, r, 0, Math.PI * 2);
    ctx.fillStyle = shade(color, 0.62);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = shade(color, 1.08);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.35, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill();

    // Eyes look toward the heading
    const ex = Math.cos(p.h), ey = Math.sin(p.h);
    const px = -ey, py = ex;
    for (const side of [-1, 1]) {
      const cx = ex * r * 0.35 + px * side * r * 0.36;
      const cy = ey * r * 0.35 + py * side * r * 0.36;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.27, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + ex * r * 0.1, cy + ey * r * 0.1, r * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = '#1d2433';
      ctx.fill();
    }
    ctx.restore();
  }

  drawMinimap(client, state) {
    const { ctx, dpr, h } = this;
    const size = Math.min(150, Math.max(100, this.w * 0.14));
    const R = client.config.arenaRadius;
    const cx = 16 + size / 2, cy = h - 16 - size / 2;
    const k = size / 2 / R;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30,40,62,0.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(238,242,248,0.92)';
    ctx.fill();

    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * cx, dpr * cy);
    for (const [id, zone] of client.zones) {
      const info = client.roster.get(id);
      if (!info || zone.empty) continue;
      ctx.fillStyle = info.color;
      ctx.fill(zone.path, 'evenodd');
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of state.players) {
      if (!p.alive || !p.info) continue;
      const isMe = p.id === client.me;
      ctx.beginPath();
      ctx.arc(cx + p.x * k, cy + p.y * k, isMe ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = isMe ? '#fff' : shade(p.info.color, 0.6);
      ctx.fill();
      if (isMe) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#1d2433';
        ctx.stroke();
      }
    }
  }
}
