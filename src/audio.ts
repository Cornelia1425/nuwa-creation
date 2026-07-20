// Looping audio with volume fades. Pausing keeps the playhead where it
// was, so turning it back on resumes the track instead of restarting.

export class FadeLoopAudio {
  private audio: HTMLAudioElement;
  private target = 0;
  private volume = 0;

  constructor(
    url: string,
    /** Volume easing rates, per second. */
    private fadeInRate = 1.6,
    private fadeOutRate = 0.9,
    private maxVolume = 1,
  ) {
    this.audio = new Audio(url);
    this.audio.loop = true;
    this.audio.preload = 'auto';
  }

  /**
   * Must be called from a user gesture (the Start button): plays and
   * immediately pauses so later programmatic play() isn't blocked by
   * autoplay policies.
   */
  unlock(): void {
    this.audio.volume = 0;
    void this.audio
      .play()
      .then(() => this.audio.pause())
      .catch(() => {});
  }

  setPlaying(on: boolean): void {
    this.target = on ? 1 : 0;
    if (on && this.audio.paused) {
      void this.audio.play().catch(() => {});
    }
  }

  update(dtMs: number): void {
    const rate = this.target > this.volume ? this.fadeInRate : this.fadeOutRate;
    const k = 1 - Math.exp(-rate * (dtMs / 1000));
    this.volume += (this.target - this.volume) * k;
    this.audio.volume = Math.min(1, Math.max(0, this.volume * this.maxVolume));
    if (this.target === 0 && this.volume < 0.01 && !this.audio.paused) {
      this.audio.pause();
      this.volume = 0;
    }
  }
}
