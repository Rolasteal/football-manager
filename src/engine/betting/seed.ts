/**
 * RNG seeded (mulberry32) per generare promozioni, jitter margini, eventi narrativi
 * in modo deterministico rispetto al seed del savegame.
 */

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function rngFromString(seed: string): Rng {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return mulberry32(h >>> 0)
}

export function jitter(rng: Rng, base: number, spreadPct: number): number {
  const delta = base * spreadPct * (rng() * 2 - 1)
  return base + delta
}

export function pickWeighted<T>(rng: Rng, items: { value: T; weight: number }[]): T {
  const total = items.reduce((s, it) => s + it.weight, 0)
  let r = rng() * total
  for (const it of items) {
    r -= it.weight
    if (r <= 0) return it.value
  }
  return items[items.length - 1].value
}
