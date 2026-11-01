import ClipperLib from 'clipper-lib';

const { Clipper, ClipType, PolyType, PolyFillType } = ClipperLib;

// Clipper works on integer coordinates; world units are multiplied by SCALE.
export const SCALE = 100;
const CLEAN_DISTANCE = 4;

export function circlePath(cx, cy, r, n) {
  const path = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    path.push({ X: Math.round((cx + Math.cos(a) * r) * SCALE), Y: Math.round((cy + Math.sin(a) * r) * SCALE) });
  }
  return path;
}

export function pointsToPath(points) {
  return points.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
}

function execute(type, subject, clip) {
  const c = new Clipper();
  c.AddPaths(subject, PolyType.ptSubject, true);
  c.AddPaths(clip, PolyType.ptClip, true);
  const out = [];
  c.Execute(type, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return Clipper.CleanPolygons(out, CLEAN_DISTANCE).filter((p) => p.length >= 3);
}

export const union = (a, b) => execute(ClipType.ctUnion, a, b);
export const difference = (a, b) => execute(ClipType.ctDifference, a, b);
export const intersection = (a, b) => execute(ClipType.ctIntersection, a, b);

// Clipper emits outer rings with positive area and holes with negative area.
export function fillHoles(paths) {
  return paths.filter((p) => Clipper.Area(p) > 0);
}

export function pathsArea(paths) {
  let a = 0;
  for (const p of paths) a += Clipper.Area(p);
  return Math.abs(a) / (SCALE * SCALE);
}

export function makeZone(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) {
    for (const pt of path) {
      if (pt.X < minX) minX = pt.X;
      if (pt.Y < minY) minY = pt.Y;
      if (pt.X > maxX) maxX = pt.X;
      if (pt.Y > maxY) maxY = pt.Y;
    }
  }
  return {
    paths,
    area: pathsArea(paths),
    bbox: paths.length ? { minX, minY, maxX, maxY } : null,
  };
}

export const EMPTY_ZONE = Object.freeze({ paths: [], area: 0, bbox: null });

export function bboxOverlap(a, b) {
  if (!a || !b) return false;
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

// Even-odd ray cast across all rings, so holes nested in outers are handled.
export function pointInZone(zone, x, y) {
  if (!zone.bbox) return false;
  const px = x * SCALE, py = y * SCALE;
  const b = zone.bbox;
  if (px < b.minX || px > b.maxX || py < b.minY || py > b.maxY) return false;
  let inside = false;
  for (const path of zone.paths) {
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
      const xi = path[i].X, yi = path[i].Y, xj = path[j].X, yj = path[j].Y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function distToSegmentSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px, cy = ay + dy * t - py;
  return cx * cx + cy * cy;
}

export function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function zoneToWire(zone) {
  return zone.paths.map((path) => {
    const flat = new Array(path.length * 2);
    for (let i = 0; i < path.length; i++) {
      flat[i * 2] = path[i].X;
      flat[i * 2 + 1] = path[i].Y;
    }
    return flat;
  });
}
