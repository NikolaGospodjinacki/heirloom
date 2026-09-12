// Deterministic-ish RNG helpers. Seeded so bloodlines / villages can be reproduced.

export class RNG {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    // xorshift32
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  // Bell-ish distribution, good for rolling ancestor stats: mostly average, rare extremes.
  bell(min: number, max: number, samples = 3): number {
    let t = 0;
    for (let i = 0; i < samples; i++) t += this.next();
    return Math.round(min + (t / samples) * (max - min));
  }
}

export const rng = new RNG((Math.random() * 0xffffffff) >>> 0);

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
