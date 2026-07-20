import { Container, Graphics } from 'pixi.js';
import type { ScreenPoint } from './renderer';

const FIGURE_BODY = 0x1a1a1a;
const FIGURE_HEAD = 0x222222;
const FIGURE_SHADOW = 0x050505;

interface ClayDrawInput {
  snapTriggered: boolean;
  /** Snap position in screen coordinates (mini humans live in screen space). */
  snapScreen: ScreenPoint | null;
  /** Nearest ground line in screen coordinates (bottom of the depth band). */
  groundScreenY: number;
  screenW: number;
  screenH: number;
  dtMs: number;
}

/** One brush-stroke limb: direction, length (in figure units) and curvature. */
interface LimbPose {
  angle: number;
  len: number;
  bend: number;
}

/** Ink-figure dance pose, fixed at spawn so landed humans never move. */
interface FigurePose {
  lean: number;
  armL: LimbPose;
  armR: LimbPose;
  legL: LimbPose;
  legR: LimbPose;
}

interface MiniHuman {
  x: number;
  y: number;
  ageMs: number;
  scale: number;
  pose: FigurePose;
  popMs: number;
  /** 0 = far (horizon), 1 = near (bottom edge) — drives size and fog. */
  depth: number;
}

interface MudDrop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  /** Where in the ground band this drop will land (0 far … 1 near). */
  landT: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep01(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function randomLimb(
  baseAngle: number,
  spread: number,
  lenMin: number,
  lenMax: number,
): LimbPose {
  return {
    angle: baseAngle + (Math.random() - 0.5) * spread,
    len: lenMin + Math.random() * (lenMax - lenMin),
    bend: (Math.random() - 0.5) * 0.6,
  };
}

/**
 * Matisse-like dance pose: one arm flung high, the other out to the
 * side, legs in a spread stance — randomized per figure.
 */
function randomDancePose(): FigurePose {
  const up = -Math.PI / 2;
  const down = Math.PI / 2;
  const highArm = randomLimb(up + (Math.random() - 0.5) * 1.1, 0.6, 8, 11);
  const sideArm = randomLimb(
    up + (Math.random() < 0.5 ? -1 : 1) * (1.3 + Math.random() * 0.8),
    0.5,
    7,
    10,
  );
  const swap = Math.random() < 0.5;
  return {
    lean: (Math.random() - 0.5) * 0.8,
    armL: swap ? highArm : sideArm,
    armR: swap ? sideArm : highArm,
    legL: randomLimb(down + 0.3 + Math.random() * 0.5, 0.3, 10.5, 13.5),
    legR: randomLimb(down - (0.3 + Math.random() * 0.5), 0.3, 10.5, 13.5),
  };
}

/**
 * Fills a curved, tapering brush stroke from (x0,y0) along `angle`:
 * width w0 at the root shrinking to w1 at the tip, bowed sideways by
 * `bend` — the building block of the ink-silhouette figures.
 */
function drawTaperedLimb(
  g: Graphics,
  x0: number,
  y0: number,
  angle: number,
  len: number,
  bend: number,
  w0: number,
  w1: number,
  color: number,
  alpha: number,
): void {
  const x1 = x0 + Math.cos(angle) * len;
  const y1 = y0 + Math.sin(angle) * len;
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  const mx = (x0 + x1) / 2 + nx * bend * len;
  const my = (y0 + y1) / 2 + ny * bend * len;
  const wm = (w0 + w1) / 2;

  g.moveTo(x0 + nx * w0, y0 + ny * w0)
    .quadraticCurveTo(mx + nx * wm, my + ny * wm, x1 + nx * w1, y1 + ny * w1)
    .lineTo(x1 - nx * w1, y1 - ny * w1)
    .quadraticCurveTo(mx - nx * wm, my - ny * wm, x0 - nx * w0, y0 - ny * w0)
    .closePath()
    .fill({ color, alpha });
}

export class ClayCharacterRenderer {
  /**
   * Stage-level layer in screen coordinates. Mud drops and landed mini
   * humans live here so they stay put regardless of hand movement.
   */
  readonly groundRoot = new Container();

  private floor = new Graphics();
  private miniHumans = new Graphics();
  private mudSplashes = new Graphics();
  private miniList: MiniHuman[] = [];
  private dropList: MudDrop[] = [];

  // Depth band of the 2.5D ground plane, refreshed each update.
  private horizonY = 0;
  private nearGroundY = 0;
  private screenCenterX = 0;

  constructor() {
    this.groundRoot.addChild(this.floor, this.mudSplashes, this.miniHumans);
  }

  update(input: ClayDrawInput): void {
    // Ground plane: a depth band from the horizon down to the screen
    // bottom. A deep band gives the valley room to read between the
    // horizon plateau and the big foreground figures.
    this.nearGroundY = input.groundScreenY;
    const band = Math.max(140, Math.min(300, input.screenH * 0.26));
    this.horizonY = this.nearGroundY - band;
    this.screenCenterX = input.screenW / 2;

    if (input.snapTriggered && input.snapScreen) {
      this.spawnMudDrops(input.snapScreen);
    }

    this.updateMudDrops(input.dtMs);
    this.updateMiniHumans(input.dtMs);
    this.drawFloor(input.screenW, input.screenH);
    this.drawMudDrops();
    this.drawMiniHumans();
  }

  /**
   * Rolling-plain height offset (px) at a given x/depth. Deterministic,
   * so figures share one coherent terrain; the swell grows toward the
   * viewer like hills receding to a flat horizon.
   */
  private terrainOffset(x: number, depth: number): number {
    const wave =
      Math.sin(x * 0.011 + 1.7) * 0.6 +
      Math.sin(x * 0.027 + 0.4) * 0.3 +
      Math.sin(x * 0.053) * 0.1;
    return wave * lerp(2, 26, depth);
  }

  /**
   * Ground contour (screen y) at horizontal x and depth t (0 far … 1
   * near): rolling terrain plus a mid-distance dip so the middle band
   * reads as a valley between the horizon plateau and the foreground.
   */
  private groundLine(x: number, t: number): number {
    const band = this.nearGroundY - this.horizonY;
    const dip = band * 0.24 * Math.sin(clamp01(t) * Math.PI) ** 1.5;
    return lerp(this.horizonY, this.nearGroundY, t) + this.terrainOffset(x, t) + dip;
  }

  /**
   * Rolling plain built from stacked terrain-following contours — no
   * ruler-straight bands — with a shadowed valley in the middle
   * distance and faint rim light on the crests.
   */
  private drawFloor(screenW: number, screenH: number): void {
    this.floor.clear();
    const seg = 28;
    const lineAlong = (t: number) => {
      this.floor.moveTo(0, this.groundLine(0, t));
      for (let i = 1; i <= seg; i += 1) {
        const x = (screenW / seg) * i;
        this.floor.lineTo(x, this.groundLine(x, t));
      }
    };
    const fillBelow = (t: number, alpha: number) => {
      lineAlong(t);
      this.floor
        .lineTo(screenW, screenH + 2)
        .lineTo(0, screenH + 2)
        .closePath()
        .fill({ color: 0x0d0803, alpha });
    };

    // Each layer's edge rolls with the terrain; overlaps build the
    // darkening gradient toward the viewer.
    fillBelow(0.02, 0.08);
    fillBelow(0.24, 0.07);
    fillBelow(0.5, 0.08);
    fillBelow(0.74, 0.09);
    fillBelow(0.92, 0.1);

    // Valley shadow: the band between the far lip and the near slope.
    lineAlong(0.3);
    for (let i = seg; i >= 0; i -= 1) {
      const x = (screenW / seg) * i;
      this.floor.lineTo(x, this.groundLine(x, 0.68));
    }
    this.floor.closePath().fill({ color: 0x070402, alpha: 0.18 });

    // Rim light: horizon ridge, the valley's far lip, a foreground crest.
    lineAlong(0);
    this.floor.stroke({ width: 1.5, color: 0xc8916b, alpha: 0.12 });
    lineAlong(0.3);
    this.floor.stroke({ width: 1.5, color: 0xc8916b, alpha: 0.08 });
    lineAlong(0.86);
    this.floor.stroke({ width: 1.5, color: 0xc8916b, alpha: 0.07 });
  }

  private updateMiniHumans(dtMs: number): void {
    for (const mini of this.miniList) {
      mini.ageMs += dtMs;
      mini.popMs += dtMs;
    }
  }

  /** Ground y for a figure standing at (x, depth), following the terrain. */
  private groundYAt(x: number, depth: number): number {
    return this.groundLine(x, depth);
  }

  private spawnMiniHumanFromDrop(x: number, depth: number): void {
    // Vanishing-point perspective: far landings converge toward the
    // screen center, near ones spread outward — the ground reads as a
    // receding plane instead of a flat strip.
    const spread = lerp(0.58, 1.06, depth);
    const baseX = this.screenCenterX + (x - this.screenCenterX) * spread;
    // Extreme two-plane perspective: horizon figures are tiny specks,
    // foreground figures loom large — no in-between sizes.
    const scale = (0.9 + Math.random() * 0.2) * lerp(0.3, 3.4, depth ** 1.4);

    // Each figure claims a personal-space disc that grows with its
    // size. Sample a few horizontal slots around the landing spot and
    // keep the least-crowded one so figures avoid piling up — big
    // foreground figures demand far more elbow room than distant specks.
    const halfWidth = (s: number) => 5 + 13 * s;
    let bestX = baseX + (Math.random() - 0.5) * 10;
    let bestGap = -Infinity;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const wander = attempt === 0 ? 10 : 40 + attempt * 34;
      const candX = baseX + (Math.random() - 0.5) * wander;
      const candY = this.groundYAt(candX, depth);
      let gap = Infinity;
      for (const other of this.miniList) {
        // Only figures in roughly the same row crowd each other; near
        // figures are allowed to stand in front of (and occlude)
        // figures further back.
        if (Math.abs(other.depth - depth) > 0.12) continue;
        const need = halfWidth(scale) + halfWidth(other.scale);
        const dist = Math.hypot(candX - other.x, (candY - other.y) * 2);
        gap = Math.min(gap, dist - need);
      }
      if (gap > bestGap) {
        bestGap = gap;
        bestX = candX;
      }
      if (gap >= 0) break;
    }

    this.miniList.push({
      x: bestX,
      y: this.groundYAt(bestX, depth),
      ageMs: 0,
      scale,
      pose: randomDancePose(),
      popMs: 0,
      depth,
    });
    // Painter's algorithm: draw far figures first so near ones,
    // whatever hill they stand on, overlap them.
    this.miniList.sort((a, b) => a.depth - b.depth);
  }

  private spawnMudDrops(originScreen: ScreenPoint): void {
    // Splash downward: drops scatter sideways and always start falling,
    // never tossed upward. All values are in screen pixels.
    const count = 6 + Math.round(Math.random() * 4);
    for (let i = 0; i < count; i += 1) {
      const sideSpeed = (Math.random() - 0.5) * 20;
      const downSpeed = 3 + Math.random() * 8;
      this.dropList.push({
        x: originScreen.x + (Math.random() - 0.5) * 14,
        y: originScreen.y + (Math.random() - 0.5) * 10,
        vx: sideSpeed,
        vy: downSpeed,
        size: 4.5 + Math.random() * 8,
        // Two distinct planes, no middle ground: most drops land as a
        // crowd of tiny silhouettes hugging the horizon, and only the
        // occasional one steps right up front as a huge figure.
        landT:
          Math.random() < 0.84
            ? Math.random() * 0.18 // back rows: tiny, at the horizon
            : 0.82 + Math.random() * 0.18, // front row: very large
      });
    }
  }

  // Gravity in velocity-units (px-per-16.67ms-frame) gained per ms.
  private static readonly GRAVITY_PER_MS = 0.007;
  // Horizontal air drag so tossed drops arc naturally instead of gliding.
  private static readonly AIR_DRAG_PER_MS = 0.0004;

  private updateMudDrops(dtMs: number): void {
    // Every drop keeps falling under gravity until it reaches its own
    // landing line inside the ground depth band, where it always becomes
    // a mini human — drops are never discarded.
    const nextDrops: MudDrop[] = [];
    for (const drop of this.dropList) {
      drop.vy += ClayCharacterRenderer.GRAVITY_PER_MS * dtMs;
      drop.vx *= Math.max(0, 1 - ClayCharacterRenderer.AIR_DRAG_PER_MS * dtMs);
      drop.x += drop.vx * (dtMs / 16.67);
      drop.y += drop.vy * (dtMs / 16.67);

      const landY = this.groundLine(drop.x, drop.landT);
      if (drop.y >= landY) {
        this.spawnMiniHumanFromDrop(drop.x, drop.landT);
      } else {
        nextDrops.push(drop);
      }
    }
    this.dropList = nextDrops;
  }

  private drawMudDrops(): void {
    this.mudSplashes.clear();
    for (const splash of this.dropList) {
      const speed = Math.hypot(splash.vx, splash.vy);
      const alpha = lerp(0.28, 0.72, clamp01((speed - 2) / 14));
      // Perspective: drops headed for the far ground read smaller.
      const r = splash.size * lerp(0.45, 1.3, splash.landT);
      this.mudSplashes
        .ellipse(splash.x, splash.y, r, r * 0.78)
        .fill({ color: 0x5f3f2b, alpha });
    }
  }

  private drawMiniHumans(): void {
    this.miniHumans.clear();
    const g = this.miniHumans;
    for (const mini of this.miniList) {
      const popT = clamp01(mini.popMs / 360);
      const fade = smoothstep01(mini.ageMs / 700);
      const s = mini.scale * lerp(0.25, 1.08, popT);
      // Atmospheric perspective: far silhouettes fade into the haze,
      // near ones are fully opaque so they cleanly cover figures behind.
      const alpha = fade * lerp(0.42, 1, mini.depth);
      const { pose } = mini;

      // Landed humans stand still: (x, y) is the fixed foot/ground anchor.
      const footX = mini.x;
      const footY = mini.y;
      const hipX = footX;
      const hipY = footY - 11.5 * s;

      g.ellipse(footX, footY + 1.2 * s, 6.5 * s, 1.6 * s).fill({
        color: FIGURE_SHADOW,
        alpha: alpha * 0.16,
      });

      // Legs: wide at the hip, tapering to pointed feet.
      drawTaperedLimb(
        g, hipX, hipY, pose.legL.angle, pose.legL.len * s, pose.legL.bend,
        2.2 * s, 0.4 * s, FIGURE_BODY, alpha,
      );
      drawTaperedLimb(
        g, hipX, hipY, pose.legR.angle, pose.legR.len * s, pose.legR.bend,
        2.2 * s, 0.4 * s, FIGURE_BODY, alpha,
      );

      // Torso: a leaning stroke, full hips tapering to the neck.
      const torsoAngle = -Math.PI / 2 + pose.lean * 0.7;
      const torsoLen = 13.5 * s;
      const neckX = hipX + Math.cos(torsoAngle) * torsoLen;
      const neckY = hipY + Math.sin(torsoAngle) * torsoLen;
      drawTaperedLimb(
        g, hipX, hipY, torsoAngle, torsoLen, pose.lean * 0.3,
        3.0 * s, 1.0 * s, FIGURE_BODY, alpha,
      );

      // Arms sweep out from the shoulders with pointed hands.
      const shoulderX = neckX;
      const shoulderY = neckY + 1.2 * s;
      drawTaperedLimb(
        g, shoulderX, shoulderY, pose.armL.angle, pose.armL.len * s, pose.armL.bend,
        1.4 * s, 0.3 * s, FIGURE_BODY, alpha,
      );
      drawTaperedLimb(
        g, shoulderX, shoulderY, pose.armR.angle, pose.armR.len * s, pose.armR.bend,
        1.4 * s, 0.3 * s, FIGURE_BODY, alpha,
      );

      // Small oval head continuing the torso's lean.
      const headX = neckX + Math.cos(torsoAngle) * 4.2 * s;
      const headY = neckY + Math.sin(torsoAngle) * 4.2 * s;
      g.ellipse(headX, headY, 2.4 * s, 3.0 * s).fill({ color: FIGURE_HEAD, alpha });
    }
  }
}
