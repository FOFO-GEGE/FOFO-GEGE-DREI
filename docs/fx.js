// Effects layer: particles, number count-up, impact shake.
// Everything here is decorative — it degrades to nothing under
// prefers-reduced-motion and never gates a state change.

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------- Particle canvas ----------

let fxCanvas = null;
let fxCtx = null;
let particles = [];
let rafId = null;

function ensureCanvas() {
  if (fxCanvas) return;
  fxCanvas = document.createElement('canvas');
  fxCanvas.className = 'fx-canvas';
  document.body.appendChild(fxCanvas);
  fxCtx = fxCanvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!fxCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fxCanvas.width = window.innerWidth * dpr;
  fxCanvas.height = window.innerHeight * dpr;
  fxCanvas.style.width = window.innerWidth + 'px';
  fxCanvas.style.height = window.innerHeight + 'px';
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function tick() {
  const w = window.innerWidth, h = window.innerHeight;
  fxCtx.clearRect(0, 0, w, h);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += p.gravity;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 1;
    p.rot += p.spin;

    if (p.life <= 0 || p.y > h + 60) { particles.splice(i, 1); continue; }

    const alpha = Math.min(1, p.life / p.fade);
    fxCtx.save();
    fxCtx.globalAlpha = alpha;
    fxCtx.translate(p.x, p.y);
    fxCtx.rotate(p.rot);
    fxCtx.fillStyle = p.color;
    if (p.shape === 'rect') fxCtx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    else { fxCtx.beginPath(); fxCtx.arc(0, 0, p.size / 2, 0, Math.PI * 2); fxCtx.fill(); }
    fxCtx.restore();
  }

  if (particles.length) rafId = requestAnimationFrame(tick);
  else { rafId = null; fxCtx.clearRect(0, 0, w, h); }
}

function spawn(list) {
  if (REDUCED.matches) return;
  ensureCanvas();
  particles.push(...list);
  if (particles.length > 420) particles.splice(0, particles.length - 420);
  if (!rafId) rafId = requestAnimationFrame(tick);
}

const HOT = ['#ffc53d', '#ff9a3d', '#ff2d95', '#ffe6a3', '#ffffff'];
const COLD = ['#ff3b5c', '#ff6b7f', '#7a1229', '#c9314c'];

// Radial burst from a point — used when a promise is kept.
function fxBurst(x, y, opts = {}) {
  const n = opts.count ?? 46;
  const palette = opts.colors || HOT;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const speed = (opts.speed ?? 7) * (0.45 + Math.random() * 0.9);
    out.push({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 2.2,
      size: 4 + Math.random() * 8,
      color: palette[(Math.random() * palette.length) | 0],
      gravity: 0.24, drag: 0.975,
      life: 52 + Math.random() * 34, fade: 34,
      rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.32,
      shape: Math.random() > 0.45 ? 'rect' : 'dot',
    });
  }
  spawn(out);
}

// Shards falling from the impact point — used when one is broken.
function fxShatter(x, y) {
  const out = [];
  for (let i = 0; i < 30; i++) {
    out.push({
      x: x + (Math.random() - 0.5) * 90,
      y: y + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 4.5,
      vy: 1.5 + Math.random() * 3,
      size: 3 + Math.random() * 7,
      color: COLD[(Math.random() * COLD.length) | 0],
      gravity: 0.42, drag: 0.99,
      life: 46 + Math.random() * 26, fade: 26,
      rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.5,
      shape: 'rect',
    });
  }
  spawn(out);
}

// Full-width rain — reserved for a flawless day.
function fxConfetti() {
  const w = window.innerWidth;
  const out = [];
  for (let i = 0; i < 130; i++) {
    out.push({
      x: Math.random() * w,
      y: -20 - Math.random() * 220,
      vx: (Math.random() - 0.5) * 2.4,
      vy: 2 + Math.random() * 3.5,
      size: 5 + Math.random() * 9,
      color: HOT[(Math.random() * HOT.length) | 0],
      gravity: 0.05, drag: 0.998,
      life: 170 + Math.random() * 90, fade: 50,
      rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.34,
      shape: 'rect',
    });
  }
  spawn(out);
}

function fxBurstFrom(el, opts) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  fxBurst(r.left + r.width / 2, r.top + r.height / 2, opts);
}

// Reserved for a tier crossing — the rarest moment in a card's life, not
// something that should show up on an ordinary "Fait" or it would stop
// meaning anything within a week. Several bursts staggered like real
// fireworks, rising from low on the screen rather than exploding in place.
function fxFireworks() {
  if (REDUCED.matches) return;
  const w = window.innerWidth, h = window.innerHeight;
  const palettes = [HOT, ['#8b5cf6', '#c4b5fd', '#4c1d95', '#ede9fe'], HOT.concat(['#4fc3f7'])];
  const rounds = 5;
  for (let i = 0; i < rounds; i++) {
    setTimeout(() => {
      const x = w * (0.25 + Math.random() * 0.5);
      const y = h * (0.25 + Math.random() * 0.35);
      fxBurst(x, y, { count: 70, speed: 9, colors: palettes[i % palettes.length] });
    }, i * 260);
  }
}

// ---------- Number count-up ----------

function fxCountUp(el, to, opts = {}) {
  if (!el) return;
  const suffix = opts.suffix || '';
  if (REDUCED.matches) { el.textContent = to + suffix; return; }
  const from = opts.from ?? 0;
  const dur = opts.duration ?? 900;
  const start = performance.now();

  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    // easeOutExpo — fast out of the gate, long settle
    const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    el.textContent = Math.round(from + (to - from) * e) + suffix;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---------- Impact shake ----------

function fxShake(el, variant = 'hit') {
  if (!el || REDUCED.matches) return;
  const cls = variant === 'hard' ? 'fx-shake-hard' : 'fx-shake';
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 620);
}

// ---------- Card tilt ----------

// Pointer-tracked 3D tilt + moving highlight. Touch-friendly: bound on
// pointermove so it works for a drag on mobile as well as hover on desktop.
function fxBindTilt(root) {
  if (REDUCED.matches) return;
  root.querySelectorAll('.pcard').forEach(card => {
    if (card.dataset.tiltBound) return;
    card.dataset.tiltBound = '1';

    const reset = () => {
      card.style.setProperty('--tilt-x', '0deg');
      card.style.setProperty('--tilt-y', '0deg');
      card.style.setProperty('--holo-x', '50%');
    };

    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.setProperty('--tilt-y', `${(px - 0.5) * 16}deg`);
      card.style.setProperty('--tilt-x', `${(0.5 - py) * 16}deg`);
      card.style.setProperty('--holo-x', `${px * 100}%`);
    });
    card.addEventListener('pointerleave', reset);
    card.addEventListener('pointercancel', reset);
    reset();
  });
}

// ---------- Card focus: pivot in place ----------

// Binds `card` so it turns in place — its position never changes, only its
// orientation. One finger tilts it around the X/Y axes in the direction of
// the drag, continuously and without a small-angle cap, so a full-length
// drag carries it past 90° and all the way through a genuine flip. Two
// fingers spin it around Z, by the same angle the fingers turn through. Both
// spring back to a flat, neutral orientation the moment every pointer lifts.
// Returns `consumeDrag()`, which a caller can use right after a click to
// tell a real turn apart from a plain tap (so releasing one doesn't also
// fire whatever the tap does).
function fxBindCardTurn(card) {
  if (REDUCED.matches) return { consumeDrag: () => false };

  const TILT_SENS = 0.6; // deg per px dragged
  const pointers = new Map(); // pointerId -> {x, y}
  let rotX = 0, rotY = 0, rotZ = 0;
  let dragOrigin = null;    // pointer position the current tilt offset is relative to
  let baseRotX = 0, baseRotY = 0;
  let pivotStartAngle = 0, pivotBaseRotZ = 0;
  let gestureStart = { x: 0, y: 0, z: 0 };
  let moved = false;

  const angleBetween = pts => {
    const [a, b] = pts;
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  };
  const apply = () => {
    card.style.transform = `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg)`;
  };
  const startTiltFromOnePointer = () => {
    const [p] = pointers.values();
    dragOrigin = { x: p.x, y: p.y };
    baseRotX = rotX; baseRotY = rotY;
  };

  card.addEventListener('pointerdown', e => {
    card.setPointerCapture(e.pointerId);
    if (pointers.size === 0) {
      gestureStart = { x: rotX, y: rotY, z: rotZ };
      card.style.transition = 'none';
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      startTiltFromOnePointer();
    } else if (pointers.size === 2) {
      pivotStartAngle = angleBetween([...pointers.values()]);
      pivotBaseRotZ = rotZ;
    }
  });

  card.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      rotZ = pivotBaseRotZ + (angleBetween([...pointers.values()]) - pivotStartAngle);
    } else if (dragOrigin) {
      const [p] = pointers.values();
      rotY = baseRotY + (p.x - dragOrigin.x) * TILT_SENS;
      rotX = baseRotX - (p.y - dragOrigin.y) * TILT_SENS;
    }
    if (Math.abs(rotX - gestureStart.x) > 3 || Math.abs(rotY - gestureStart.y) > 3 || Math.abs(rotZ - gestureStart.z) > 3) moved = true;
    apply();
  });

  const release = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) startTiltFromOnePointer(); // keep tracking the remaining finger
    if (pointers.size > 0) return;

    card.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1)';
    rotX = 0; rotY = 0; rotZ = 0;
    apply();
  };
  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);

  return {
    consumeDrag: () => { const m = moved; moved = false; return m; },
  };
}
