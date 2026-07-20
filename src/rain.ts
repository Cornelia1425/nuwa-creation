// Rain: a full-screen layer of slanted falling streaks. Fades in when
// rain starts and out when it stops (triggered by full-screen hand
// swipes); the matching sound lives in audio.ts (FadeLoopAudio).

import { Container, Graphics } from 'pixi.js';

const RAIN_COLOR = 0xbdd2e2;
const DROP_COUNT = 170;
/** Intensity easing rates (per second): rain builds faster than it dies. */
const FADE_IN_RATE = 1.6;
const FADE_OUT_RATE = 0.9;

interface RainDrop {
  x: number;
  y: number;
  len: number;
  speed: number;
  drift: number;
  thickness: number;
}

export class RainLayer {
  readonly root = new Container();
  private streaks = new Graphics();
  private tint = new Graphics();
  private drops: RainDrop[] = [];
  private intensity = 0;
  private target = 0;

  init(screenW: number, screenH: number): void {
    this.root.addChild(this.tint, this.streaks);
    for (let i = 0; i < DROP_COUNT; i += 1) {
      this.drops.push(this.makeDrop(screenW, screenH, true));
    }
  }

  setRaining(on: boolean): void {
    this.target = on ? 1 : 0;
  }

  get isRaining(): boolean {
    return this.target > 0.5;
  }

  private makeDrop(screenW: number, screenH: number, anywhere: boolean): RainDrop {
    // Depth variation: far drops are short, slow and thin.
    const depth = Math.random();
    return {
      x: Math.random() * (screenW + 120) - 60,
      y: anywhere ? Math.random() * screenH : -30 - Math.random() * 80,
      len: 10 + depth * 22,
      speed: 420 + depth * 520,
      drift: -30 - depth * 50,
      thickness: 1 + depth * 0.8,
    };
  }

  update(dtMs: number, screenW: number, screenH: number): void {
    const rate = this.target > this.intensity ? FADE_IN_RATE : FADE_OUT_RATE;
    const k = 1 - Math.exp(-rate * (dtMs / 1000));
    this.intensity += (this.target - this.intensity) * k;

    this.streaks.clear();
    this.tint.clear();
    if (this.intensity < 0.01) return;

    // Overcast mood: a faint cool wash over the whole scene.
    this.tint
      .rect(0, 0, screenW, screenH)
      .fill({ color: 0x18222e, alpha: 0.14 * this.intensity });

    const dt = dtMs / 1000;
    const visible = Math.floor(this.drops.length * this.intensity);
    for (let i = 0; i < this.drops.length; i += 1) {
      const drop = this.drops[i];
      drop.x += drop.drift * dt;
      drop.y += drop.speed * dt;
      if (drop.y > screenH + drop.len || drop.x < -80) {
        this.drops[i] = this.makeDrop(screenW, screenH, false);
      }
      if (i >= visible) continue;

      const slant = drop.drift / drop.speed;
      this.streaks
        .moveTo(drop.x, drop.y)
        .lineTo(drop.x + slant * drop.len, drop.y - drop.len)
        .stroke({
          width: drop.thickness,
          color: RAIN_COLOR,
          alpha: 0.5 * this.intensity,
        });
    }
  }
}
