/**
 * Random Number Generator seedable (Mulberry32).
 * Permette generazione del mondo deterministica dato uno stesso seed.
 *
 * Uso:
 *   const rng = createRng(12345)
 *   const n = rng.next()           // float [0,1)
 *   const i = rng.int(1, 10)       // intero [1,10] inclusi
 *   const p = rng.pick(['a','b'])  // elemento random
 */

export interface Rng {
  /** Float in [0, 1) */
  next(): number
  /** Intero in [min, max] inclusi */
  int(min: number, max: number): number
  /** Float in [min, max) */
  float(min: number, max: number): number
  /** Bool con probabilità p (0..1) */
  chance(p: number): boolean
  /** Elemento random da un array (non vuoto) */
  pick<T>(arr: readonly T[]): T
  /** Shuffle in-place (Fisher-Yates), ritorna l'array */
  shuffle<T>(arr: T[]): T[]
  /** Sampling gaussiano approx (media, dev. std.) — Box-Muller */
  gauss(mean: number, std: number): number
  /** Seed corrente (per debug/persistenza) */
  seed: number
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  if (state === 0) state = 0xdeadbeef

  function next(): number {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const rng: Rng = {
    seed,
    next,
    int(min, max) {
      return Math.floor(next() * (max - min + 1)) + min
    },
    float(min, max) {
      return next() * (max - min) + min
    },
    chance(p) {
      return next() < p
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)]
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    },
    gauss(mean, std) {
      // Box-Muller
      const u = Math.max(1e-12, next())
      const v = next()
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
      return mean + z * std
    }
  }
  return rng
}

/** Genera un seed dall'orologio (per "Nuova partita random") */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}

/** Pseudo-UUID (non standard ma sufficiente per ID interni). */
export function generateId(rng?: Rng): string {
  const r = rng ?? { next: Math.random } as Rng
  const hex = () => Math.floor(r.next() * 0xffff).toString(16).padStart(4, '0')
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`
}
