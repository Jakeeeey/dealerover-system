/**
 * Minimal canvas confetti engine — module-local.
 *
 * The ported `rank-confetti.ts` originally imported `canvas-confetti`, but that
 * package is NOT installed on this branch (it only exists in the
 * `origin/global-updates` lockfile) and the project hard rule forbids adding
 * dependencies. This engine implements the small subset of the
 * `canvas-confetti` API the leaderboard actually uses, so the celebration logic
 * can ship with zero new packages.
 *
 * Supported options: particleCount, angle, spread, origin, colors, shapes,
 * scalar, startVelocity, gravity, drift, ticks, zIndex.
 */

export type ConfettiShape = "circle" | "square" | "star";

export interface ConfettiOptions {
  particleCount?: number;
  /** Degrees. 90 = straight up (canvas-confetti convention). */
  angle?: number;
  /** Total spread cone, degrees. */
  spread?: number;
  /** Normalised origin; y grows downward (0 = top). */
  origin?: { x: number; y: number };
  colors?: string[];
  shapes?: ConfettiShape[];
  scalar?: number;
  startVelocity?: number;
  gravity?: number;
  drift?: number;
  ticks?: number;
  zIndex?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  shape: ConfettiShape;
  size: number;
  rotation: number;
  spin: number;
  age: number;
  life: number;
  gravityStep: number;
  driftStep: number;
}

interface ConfettiState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  particles: Particle[];
  rafId: number;
  lastTime: number;
}

const DEFAULT_COLORS = ["#FFD700", "#F59E0B", "#FBBF24", "#FFFFFF"];
const FRICTION = 0.92;

let state: ConfettiState | null = null;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Resizes the shared canvas to the viewport (device-pixel-ratio aware). */
function resizeCanvas(s: ConfettiState): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  s.canvas.width = Math.floor(width * dpr);
  s.canvas.height = Math.floor(height * dpr);
  s.canvas.style.width = `${width}px`;
  s.canvas.style.height = `${height}px`;
  s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function ensureState(zIndex: number): ConfettiState | null {
  if (typeof document === "undefined") return null;

  if (!state) {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.background = "transparent";
    canvas.style.zIndex = String(zIndex);
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      canvas.remove();
      return null;
    }

    state = { canvas, ctx, particles: [], rafId: 0, lastTime: 0 };
    resizeCanvas(state);
    window.addEventListener("resize", () => {
      if (state) resizeCanvas(state);
    });
  }

  state.canvas.style.zIndex = String(zIndex);
  return state;
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function drawStar(ctx: CanvasRenderingContext2D, radius: number): void {
  const spikes = 5;
  const inner = radius * 0.45;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? radius : inner;
    const angle = (Math.PI / spikes) * i - Math.PI / 2;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  const alpha = Math.max(0, 1 - p.age / p.life);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.fillStyle = p.color;

  if (p.shape === "circle") {
    ctx.beginPath();
    ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.shape === "square") {
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
  } else {
    drawStar(ctx, p.size / 1.6);
  }

  ctx.restore();
}

function tick(s: ConfettiState, now: number): void {
  const ctx = s.ctx;
  const delta = s.lastTime ? Math.min(now - s.lastTime, 34) : 16.67;
  s.lastTime = now;
  const step = delta / 16.67; // normalise to 60fps

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  for (let i = s.particles.length - 1; i >= 0; i -= 1) {
    const p = s.particles[i];
    p.age += step;
    p.vy += p.gravityStep * step;
    p.vx += p.driftStep * step;
    p.vx *= Math.pow(FRICTION, step);
    p.vy *= Math.pow(FRICTION, step);
    p.x += p.vx * step;
    p.y += p.vy * step;
    p.rotation += p.spin * step;

    if (p.age >= p.life || p.y > window.innerHeight + 40) {
      s.particles.splice(i, 1);
      continue;
    }
    drawParticle(ctx, p);
  }

  if (s.particles.length > 0) {
    s.rafId = window.requestAnimationFrame((t) => tick(s, t));
  } else {
    s.rafId = 0;
    s.lastTime = 0;
  }
}

/**
 * Fires a single confetti burst. Safe to call repeatedly; particles accumulate
 * on one shared canvas layer.
 */
export default function confetti(options: ConfettiOptions = {}): void {
  if (typeof window === "undefined") return;
  if (prefersReducedMotion()) return;

  const s = ensureState(options.zIndex ?? 99999);
  if (!s) return;

  const {
    particleCount = 50,
    angle = 90,
    spread = 45,
    origin = { x: 0.5, y: 0.5 },
    colors = DEFAULT_COLORS,
    shapes = ["circle", "square"],
    scalar = 1,
    startVelocity = 45,
    gravity = 1,
    drift = 0,
    ticks = 200,
  } = options;

  const radAngle = (angle * Math.PI) / 180;

  for (let i = 0; i < particleCount; i += 1) {
    const spreadRad = (randomBetween(-spread / 2, spread / 2) * Math.PI) / 180;
    const velocity = startVelocity * randomBetween(0.85, 1.15);
    const vAngle = radAngle + spreadRad;
    const color = colors[Math.floor(Math.random() * colors.length)] || DEFAULT_COLORS[0];
    const shape = shapes[Math.floor(Math.random() * shapes.length)] || "circle";

    s.particles.push({
      x: origin.x * window.innerWidth,
      y: origin.y * window.innerHeight,
      vx: Math.cos(vAngle) * velocity,
      vy: -Math.sin(vAngle) * velocity,
      color,
      shape,
      size: randomBetween(6, 11) * scalar,
      rotation: randomBetween(0, Math.PI * 2),
      spin: randomBetween(-0.2, 0.2),
      age: 0,
      life: ticks * randomBetween(0.8, 1.15),
      gravityStep: gravity * 0.35,
      driftStep: drift * 0.12,
    });
  }

  if (s.particles.length > 0 && !s.rafId) {
    s.rafId = window.requestAnimationFrame((t) => tick(s, t));
  }
}
