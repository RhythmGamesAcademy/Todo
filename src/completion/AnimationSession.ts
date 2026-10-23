/** Owns every resource created by one playback, including interrupted playback. */
export class AnimationSession {
  private animations: Animation[] = [];
  private cleanups = new Set<() => void>();
  private disposed = false;

  get active() {
    return !this.disposed;
  }

  start(
    element: Element,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    this.assertActive();
    const animation = element.animate(frames, { ...options, fill: "forwards" });
    // Some animations are decorative; cancellation still needs a rejection handler.
    void animation.finished.catch(() => {});
    this.animations.push(animation);
    return animation;
  }

  async play(
    element: Element,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    await this.start(element, frames, options).finished;
    this.assertActive();
  }

  own(dispose: () => void) {
    if (this.disposed) {
      dispose();
      return () => {};
    }
    const release = () => {
      if (this.cleanups.delete(release)) dispose();
    };
    this.cleanups.add(release);
    return release;
  }

  listen(target: EventTarget, type: string, listener: EventListener) {
    target.addEventListener(type, listener);
    return this.own(() => target.removeEventListener(type, listener));
  }

  after(duration: number, callback: () => void) {
    const timer = window.setTimeout(callback, duration);
    return this.own(() => window.clearTimeout(timer));
  }

  assertActive() {
    if (this.disposed) throw new DOMException("Cancelled", "AbortError");
  }

  cancel() {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.forEach((release) => release());
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
  }
}
