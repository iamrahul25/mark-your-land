const KEY_DIRS = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

// Produces a target heading (radians, screen space) from mouse, touch-drag joystick or keyboard.
export function attachInput(canvas, onAngle) {
  const pressed = new Set();
  let touchOrigin = null;

  const fromKeys = () => {
    let dx = 0, dy = 0;
    for (const code of pressed) {
      dx += KEY_DIRS[code][0];
      dy += KEY_DIRS[code][1];
    }
    if (dx || dy) onAngle(Math.atan2(dy, dx));
  };

  const onMouseMove = (e) => {
    if (pressed.size) return;
    const r = canvas.getBoundingClientRect();
    onAngle(Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2));
  };

  const onKeyDown = (e) => {
    if (!KEY_DIRS[e.code]) return;
    e.preventDefault();
    pressed.add(e.code);
    fromKeys();
  };
  const onKeyUp = (e) => {
    pressed.delete(e.code);
    fromKeys();
  };

  const onTouchStart = (e) => {
    const t = e.changedTouches[0];
    touchOrigin = { x: t.clientX, y: t.clientY };
  };
  const onTouchMove = (e) => {
    e.preventDefault();
    if (!touchOrigin) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchOrigin.x, dy = t.clientY - touchOrigin.y;
    if (dx * dx + dy * dy > 100) onAngle(Math.atan2(dy, dx));
    if (dx * dx + dy * dy > 3600) touchOrigin = { x: t.clientX - dx * 0.5, y: t.clientY - dy * 0.5 };
  };
  const onTouchEnd = () => (touchOrigin = null);

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);

  return () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onTouchEnd);
  };
}
