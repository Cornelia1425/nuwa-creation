// PixiJS v8 overlay: landmark dots + ground scene with mini humans.
//
// Coordinate mapping. Landmarks arrive normalized to the *video* frame
// (0..1). The video is displayed mirrored (transform: scaleX(-1)) and
// with object-fit: cover, which crops whichever axis overflows the
// screen. To land dots on fingers we must reproduce both:
//
//   scale = max(screenW / videoW, screenH / videoH)      // cover
//   drawnW = videoW * scale, drawnH = videoH * scale
//   offX = (screenW - drawnW) / 2, offY = (screenH - drawnH) / 2
//   x = offX + (1 - nx) * drawnW                          // mirror
//   y = offY + ny * drawnH
//
// This holds for desktop landscape (top/bottom cropped) and mobile
// portrait (left/right cropped) alike.

import { Application, Graphics } from 'pixi.js';
import { ClayCharacterRenderer } from './clayCharacter';
import { CloudLayer } from './clouds';
import { RainLayer } from './rain';

export interface ScreenPoint {
  x: number;
  y: number;
}

export function makeVideoToScreen(
  videoW: number,
  videoH: number,
  screenW: number,
  screenH: number,
): (nx: number, ny: number) => ScreenPoint {
  const scale = Math.max(screenW / videoW, screenH / videoH);
  const drawnW = videoW * scale;
  const drawnH = videoH * scale;
  const offX = (screenW - drawnW) / 2;
  const offY = (screenH - drawnH) / 2;
  return (nx, ny) => ({
    x: offX + (1 - nx) * drawnW, // mirrored to match the flipped preview
    y: offY + ny * drawnH,
  });
}

export class Renderer {
  private app = new Application();
  private dots = new Graphics();
  private clayCharacter = new ClayCharacterRenderer();
  private cloudLayer = new CloudLayer();
  private rainLayer = new RainLayer();

  async init(mount: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: window,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
    });
    this.app.canvas.className = 'pixi-canvas';
    mount.appendChild(this.app.canvas);

    // Sky sits behind everything else; the ground scene (rolling plain,
    // mud drops, landed mini humans) lives in screen space above it.
    // Rain falls in front of the scene but under the landmark dots.
    this.cloudLayer.init(this.screenW, this.screenH);
    this.rainLayer.init(this.screenW, this.screenH);
    this.app.stage.addChild(this.cloudLayer.root);
    this.app.stage.addChild(this.clayCharacter.groundRoot);
    this.app.stage.addChild(this.rainLayer.root);
    this.app.stage.addChild(this.dots);
  }

  // app.screen is always in logical (CSS) pixels — no resolution math.
  // Dividing renderer.width by resolution again would halve everything
  // on Retina displays and push the scene toward the upper-left.
  get screenW(): number {
    return this.app.screen.width;
  }
  get screenH(): number {
    return this.app.screen.height;
  }

  drawLandmarks(hands: ScreenPoint[][]): void {
    this.dots.clear();
    for (const hand of hands) {
      for (let i = 0; i < hand.length; i++) {
        const p = hand[i];
        const isTip = i === 4 || i === 8; // thumb & index tips pop
        this.dots
          .circle(p.x, p.y, isTip ? 7 : 4)
          .fill({ color: isTip ? 0xffd27f : 0xffffff, alpha: 0.9 });
      }
    }
  }

  /**
   * Per-frame scene update: clouds drift, and a correct fist-then-open
   * gesture (snapTriggered at snapPoint) throws mud that lands as mini
   * humans on the ground plane.
   */
  setRaining(on: boolean): void {
    this.rainLayer.setRaining(on);
  }

  update(dtMs: number, snapPoint: ScreenPoint | null, snapTriggered: boolean): void {
    this.cloudLayer.update(dtMs, this.screenW);
    this.rainLayer.update(dtMs, this.screenW, this.screenH);
    this.clayCharacter.update({
      snapTriggered,
      snapScreen: snapPoint,
      groundScreenY: this.screenH - 8,
      screenW: this.screenW,
      screenH: this.screenH,
      dtMs,
    });
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
