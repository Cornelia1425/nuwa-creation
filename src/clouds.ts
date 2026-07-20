// Decorative sky layer: flat, stylized swirl clouds (祥云-like) that
// drift slowly across the top of the screen, behind the clay scene.

import { Container, Graphics } from 'pixi.js';

const CLOUD_FILL = 0xf1e7d3;
const CLOUD_SHADE = 0xd9c9aa;
const CLOUD_LINE = 0x8a6f4d;

interface Puff {
  x: number;
  y: number;
  r: number;
}

// Unit cloud (~190 px wide at scale 1): a puffy body over a flat base
// with a trailing wisp, matching the painted references.
const PUFFS: Puff[] = [
  { x: -52, y: 10, r: 22 },
  { x: -18, y: -8, r: 30 },
  { x: 22, y: -2, r: 26 },
  { x: 54, y: 12, r: 17 },
];

/** Inward spiral polyline — the classic curl inside each cloud puff. */
function drawCurl(g: Graphics, cx: number, cy: number, r0: number): void {
  const turns = 1.5;
  const steps = 26;
  g.moveTo(cx + r0, cy);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const ang = t * turns * Math.PI * 2;
    const r = r0 * (1 - 0.8 * t);
    g.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
  }
  g.stroke({ width: 2.4, color: CLOUD_LINE, alpha: 0.7 });
}

function drawCloudInto(g: Graphics): void {
  // Outline pass: slightly inflated dark shapes beneath the fill.
  for (const p of PUFFS) {
    g.circle(p.x, p.y, p.r + 3.5).fill({ color: CLOUD_LINE, alpha: 0.85 });
  }
  g.ellipse(0, 22, 81, 21).fill({ color: CLOUD_LINE, alpha: 0.85 });
  g.ellipse(92, 20, 29, 10).fill({ color: CLOUD_LINE, alpha: 0.85 });

  // Fill pass.
  for (const p of PUFFS) {
    g.circle(p.x, p.y, p.r).fill(CLOUD_FILL);
  }
  g.ellipse(0, 22, 78, 18).fill(CLOUD_FILL);
  g.ellipse(92, 20, 26, 7).fill(CLOUD_FILL);

  // Soft shading along the flat base.
  g.ellipse(4, 26, 66, 11).fill({ color: CLOUD_SHADE, alpha: 0.55 });

  // Swirl curls.
  drawCurl(g, -18, -4, 15);
  drawCurl(g, 24, 2, 10);
  drawCurl(g, -52, 10, 8);
}

interface DriftingCloud {
  view: Graphics;
  speed: number;
  halfW: number;
}

export class CloudLayer {
  readonly root = new Container();
  private clouds: DriftingCloud[] = [];

  init(screenW: number, screenH: number): void {
    const count = 7;
    for (let i = 0; i < count; i += 1) {
      const g = new Graphics();
      drawCloudInto(g);

      // Strong painterly perspective: one or two huge near clouds
      // hanging low in the sky, tiny distant ones near the horizon.
      const t = i / (count - 1); // spread depths evenly, 0 far … 1 near
      const scale = 0.22 + t * t * 1.6;
      const mirror = Math.random() < 0.5 ? -1 : 1;
      g.scale.set(scale * mirror, scale);
      g.alpha = 0.42 + t * 0.4;
      g.position.set(
        Math.random() * screenW,
        screenH * (0.05 + (1 - t) * 0.13 + t * 0.13 + Math.random() * 0.05),
      );

      this.root.addChild(g);
      this.clouds.push({
        view: g,
        // Parallax: near clouds drift noticeably faster than far ones.
        speed: (4 + Math.random() * 5) * (0.35 + t * 1.25),
        halfW: 130 * scale,
      });
    }
  }

  update(dtMs: number, screenW: number): void {
    for (const cloud of this.clouds) {
      cloud.view.x += cloud.speed * (dtMs / 1000);
      if (cloud.view.x - cloud.halfW > screenW) {
        cloud.view.x = -cloud.halfW;
      }
    }
  }
}
