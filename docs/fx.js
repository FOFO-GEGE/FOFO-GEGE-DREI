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

// ---------- Card focus: pick up, throw, flip ----------

// Binds a physical drag to `handle` (the visible card) that moves and rotates
// `mover` (its wrapper) with the pointer — a small drag springs back, a big
// one dismisses like a card flung aside. A tap that barely moved is treated
// as a tap rather than a drag, and flips the card instead of closing it.
function fxBindCardDrag(handle, mover, { onTap, onDismiss } = {}) {
  if (REDUCED.matches) {
    handle.addEventListener('click', () => onTap && onTap());
    return;
  }
  let startX = 0, startY = 0, dragging = false, pointerId = null;

  handle.addEventListener('pointerdown', e => {
    pointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    dragging = true;
    mover.style.transition = 'none';
    handle.setPointerCapture(pointerId);
  });

  handle.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    mover.style.transform = `translate(${dx * 0.7}px, ${dy}px) rotate(${dx * 0.05}deg)`;
  });

  const end = e => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const dist = Math.hypot(dx, dy);
    mover.style.transition = 'transform .4s cubic-bezier(.16,1,.3,1)';

    if (Math.abs(dy) > 130 || dist > 170) {
      mover.style.transform = `translate(${dx * 1.5}px, ${dy * 1.7}px) rotate(${dx * 0.09}deg)`;
      mover.style.opacity = '0';
      onDismiss && onDismiss();
    } else {
      mover.style.transform = 'translate(0,0) rotate(0deg)';
      if (dist < 6) onTap && onTap();
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
