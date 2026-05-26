/**
 * Curva età, crescita e declino dei giocatori — Fase 3.B.
 *
 * Modello:
 * 1. Ogni player ha `potential` (overall max raggiungibile) assegnato a creazione.
 * 2. Ogni stagione, `endOfSeasonAgeTick` applica `ageTickPlayer` a tutti.
 * 3. ageTickPlayer:
 *    - Avvicina l'overall al potential se giovane (16-25)
 *    - Lo mantiene stabile al picco (24-28)
 *    - Lo allontana dal potential dopo i 29 (declino)
 *    - Modulato da `naturalFitness` (declino lento se alta) e `determination`
 *      (preserva mentali più a lungo)
 * 4. Il delta overall si distribuisce su 2-4 attributi rilevanti per ruolo:
 *    - Crescita: skill specifiche del ruolo (es. attaccante = finishing, pace, offTheBall)
 *    - Declino fisico (29-32): pace, acceleration, stamina calano per primi
 *    - Declino mentale (33+): anche composure, decisions, anticipation iniziano
 *      a cedere — ma determination alta li protegge
 *
 * Output deterministic data un seed: lo stesso roster con stesso seed produce
 * sempre lo stesso aging tra stagioni.
 */

import type { Player, PlayerAttributes, Position } from '$engine/types'
import type { Rng } from '$engine/gen/rng'
import type { Career } from './types'
import { createRng } from '$engine/gen/rng'
import { calcOverall } from '$engine/gen/player'
import { ensurePlayerFMAttributes } from '$engine/gen/playerCompat'

/** Ruolo macro per pool attributi crescita/declino */
type Role = 'GK' | 'DEF' | 'MID' | 'ATT'

const POSITION_ROLE: Record<Position, Role> = {
  GK: 'GK',
  CB: 'DEF', LB: 'DEF', RB: 'DEF', WB: 'DEF',
  DM: 'MID', CM: 'MID', AM: 'MID', LM: 'MID', RM: 'MID',
  LW: 'ATT', RW: 'ATT', CF: 'ATT', ST: 'ATT',
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function clampAttr(n: number): number {
  return clamp(Math.round(n), 1, 20)
}

/** Età alla data di riferimento (default: 1 luglio anno passato come parametro). */
export function ageFromBirthDate(birthDate: string, refYear?: number): number {
  const b = new Date(birthDate)
  const ref = new Date(`${refYear ?? new Date().getUTCFullYear()}-07-01`)
  let a = ref.getUTCFullYear() - b.getUTCFullYear()
  const m = ref.getUTCMonth() - b.getUTCMonth()
  if (m < 0 || (m === 0 && ref.getUTCDate() < b.getUTCDate())) a--
  return a
}

// ====== Curva base età → delta overall annuale ======

/**
 * Delta overall base per ogni età (16-40). Mediana, prima di modulatori.
 * Curva calibrata su dati reali Serie A: crescita rapida 16-19, picco 24-28,
 * declino moderato 29-32, declino accelerato 33+.
 *
 * NB: i valori sono delta OVERALL (1-99), non delta singolo attributo.
 */
function baseDeltaForAge(age: number): number {
  if (age <= 17) return +4
  if (age === 18) return +3
  if (age === 19) return +3
  if (age === 20) return +2
  if (age === 21) return +2
  if (age === 22) return +1
  if (age === 23) return +1
  if (age <= 28) return 0    // picco 24-28
  if (age === 29) return -1
  if (age === 30) return -1
  if (age === 31) return -2
  if (age === 32) return -2
  if (age === 33) return -3
  if (age === 34) return -3
  if (age === 35) return -4
  return -4                   // 36+
}

/**
 * Calcola il delta overall finale applicando modulatori a quello base.
 *
 * Modulatori:
 * 1. **gap potential** (solo crescita): se gap > 5 +40% delta, se gap > 10 +70%
 *    (i crack giovani esplodono rapido), se gap <= 0 niente crescita
 * 2. **naturalFitness** (solo declino): bonus = (NF - 10) / 4 → range -2.25..+2.5
 *    Esempio: NF 20 a 30 anni → delta -1 + 2.5 = +1.5 → ARROTONDATO 0 o +1
 *    (Zlatan style: declino dimezzato o assente)
 * 3. **determination** (solo declino 33+): bonus mentale = (DET - 10) / 5 → -2..+2
 *    Applicato come "protezione" sul declino: se DET alta, declino effettivo
 *    dimezzato (max 50% riduzione)
 *
 * Cap: delta finale tra -5 e +6.
 */
export function effectiveAgeDelta(player: Player, projectedAge: number): number {
  const a = player.attributes
  const potential = player.potential ?? 70
  const current = calcOverall(player)
  let delta = baseDeltaForAge(projectedAge)

  if (delta > 0) {
    // === Crescita ===
    const gap = potential - current
    if (gap <= 0) {
      delta = 0  // ha già raggiunto il potential, nessuna crescita
    } else if (gap > 10) {
      delta = Math.round(delta * 1.7)  // crack
    } else if (gap > 5) {
      delta = Math.round(delta * 1.4)  // talento
    }
  } else if (delta < 0) {
    // === Declino ===
    const nfBonus = ((a.naturalFitness ?? a.stamina) - 10) / 4
    delta += nfBonus
    // Determination protegge ulteriormente dal 33+ in poi
    if (projectedAge >= 33) {
      const detBonus = ((a.determination ?? a.workRate) - 10) / 5
      // Determination riduce il declino in valore assoluto, max -50%
      if (detBonus > 0) delta *= Math.max(0.5, 1 - detBonus * 0.25)
    }
    delta = Math.round(delta)
    if (delta > 0) delta = 0  // i modulatori positivi non possono trasformare declino in crescita
  }

  return clamp(delta, -5, 6)
}

// ====== Pool attributi per ruolo (crescita) ======

/**
 * Attributi prioritari per CRESCITA per ogni ruolo. Quando il delta è positivo,
 * vengono distribuiti i +1 su questi attributi (pesati: i primi salgono prima).
 *
 * Stile FM: il giovane MID cresce in passing/vision/decisions/technique;
 * il giovane ATT cresce in finishing/dribbling/offTheBall/pace;
 * il giovane DEF cresce in marking/tackling/positioning/strength;
 * il giovane GK cresce in reflexes/handling/oneOnOnes/anticipation.
 */
const GROWTH_POOL: Record<Role, (keyof PlayerAttributes)[]> = {
  GK: ['reflexes', 'handling', 'oneOnOnes', 'aerialReach', 'commandOfArea',
       'anticipation', 'concentration', 'positioning', 'communication',
       'kicking', 'composure'],
  DEF: ['marking', 'tackling', 'jumpingReach', 'positioning', 'anticipation',
        'heading', 'strength', 'concentration', 'decisions', 'bravery',
        'passing', 'composure'],
  MID: ['passing', 'vision', 'technique', 'decisions', 'firstTouch',
        'stamina', 'teamwork', 'workRate', 'composure', 'anticipation',
        'longShots', 'dribbling'],
  ATT: ['finishing', 'dribbling', 'offTheBall', 'pace', 'acceleration',
        'composure', 'technique', 'flair', 'longShots', 'firstTouch',
        'anticipation', 'agility'],
}

// ====== Pool attributi per declino ======

/**
 * Per i declini fisici (29-32): pace, acceleration, stamina, agility crollano.
 * NaturalFitness alta protegge ma non azzera.
 */
const DECLINE_PHYSICAL_POOL: (keyof PlayerAttributes)[] = [
  'pace', 'acceleration', 'agility', 'stamina', 'jumpingReach', 'balance',
]

/**
 * Per i declini misti (33+): si aggiungono tecnici fini e qualche mentale,
 * ma determination protegge i mentali.
 */
const DECLINE_LATE_POOL: (keyof PlayerAttributes)[] = [
  'pace', 'acceleration', 'agility', 'stamina',
  'firstTouch', 'technique', 'dribbling',
  'concentration', 'anticipation',  // mentali iniziano a calare solo a 33+
]

// ====== Apply delta ai singoli attributi ======

/**
 * Distribuisce il delta overall su attributi specifici per ruolo.
 * Ogni unità di delta = ±1 su un attributo del pool. Picks deterministic
 * sull'rng passato.
 *
 * Se delta = +3, applica +1 a 3 attributi distinti tra i primi N del pool.
 * Se delta = -2, applica -1 a 2 attributi distinti del pool declino appropriato.
 *
 * Ritorna gli attributi toccati (per logging/news future).
 */
function applyDeltaToAttributes(
  player: Player,
  delta: number,
  projectedAge: number,
  rng: Rng
): (keyof PlayerAttributes)[] {
  if (delta === 0) return []
  const role = POSITION_ROLE[player.position]
  const a = player.attributes as unknown as Record<string, number | undefined>
  const touched: (keyof PlayerAttributes)[] = []

  // Seleziona pool: crescita = GROWTH_POOL[role]; declino = fisico (29-32) o late (33+)
  let pool: (keyof PlayerAttributes)[]
  if (delta > 0) {
    pool = GROWTH_POOL[role]
  } else if (projectedAge < 33) {
    pool = DECLINE_PHYSICAL_POOL
  } else {
    pool = DECLINE_LATE_POOL
  }

  // Filter pool: solo attributi popolati (gli FM potrebbero essere undefined su save legacy
  // chiamati prima di ensurePlayerFMAttributes — safety net)
  const available = pool.filter(k => typeof a[k as string] === 'number')
  if (available.length === 0) return []

  // Bias: i primi del pool hanno più probabilità di essere scelti (peso lineare decrescente)
  const weighted: (keyof PlayerAttributes)[] = []
  available.forEach((k, idx) => {
    const w = Math.max(1, available.length - idx)
    for (let i = 0; i < w; i++) weighted.push(k)
  })

  const absDelta = Math.abs(delta)
  const sign = delta > 0 ? +1 : -1
  const picked = new Set<keyof PlayerAttributes>()

  // Pesca abs(delta) attributi distinti (o ripete se pool < |delta|)
  for (let i = 0; i < absDelta * 3 && picked.size < absDelta; i++) {
    const k = weighted[rng.int(0, weighted.length - 1)]
    if (picked.has(k)) continue
    picked.add(k)
    const curr = a[k as string] as number
    a[k as string] = clampAttr(curr + sign)
    touched.push(k)
  }
  return touched
}

// ====== Ricalcolo valore mercato ======

/**
 * Ricalcola marketValue dopo l'aging. Curva età × overall, stile transfermarkt.
 *
 * Formula:
 *   base = overall^3.2 * 1000 (€)
 *   ageFactor:
 *     16-17: 0.35  (rischio + lontano da picco)
 *     18-20: 0.55
 *     21-23: 0.85
 *     24-28: 1.00  (picco di valore)
 *     29-30: 0.85
 *     31-32: 0.60
 *     33-34: 0.40
 *     35+:   0.20
 *   GK shift: i portieri hanno il picco più tardi (~+3 anni), quindi ageFactor
 *   per GK è calcolato su (age - 3).
 *
 * Es: ATT overall 80 a 26 anni: 80^3.2 * 1000 * 1.0 = €1.06M * 1.0 = ~€1.06M
 *     ATT overall 80 a 22 anni: stesso ovr ma ageFactor 0.85 = ~€900k
 *     ATT overall 80 a 32 anni: 0.60 = ~€636k
 */
export function recalculateMarketValue(player: Player): number {
  const overall = calcOverall(player)
  const realAge = ageFromBirthDate(player.birthDate)
  const effAge = player.position === 'GK' ? Math.max(16, realAge - 3) : realAge

  let factor: number
  if (effAge <= 17) factor = 0.35
  else if (effAge <= 20) factor = 0.55
  else if (effAge <= 23) factor = 0.85
  else if (effAge <= 28) factor = 1.00
  else if (effAge <= 30) factor = 0.85
  else if (effAge <= 32) factor = 0.60
  else if (effAge <= 34) factor = 0.40
  else factor = 0.20

  // Reputation team aggiunge premium del 10-30% (top club tiene il giocatore "più caro"):
  // per ora skip — entra in 3.D quando avremo contratto + clausola

  const value = Math.round(Math.pow(overall, 3.2) * 1000 * factor)
  player.marketValue = value
  return value
}

// ====== Tick singolo giocatore ======

/**
 * Avanza il giocatore di 1 stagione: applica il delta età ai suoi attributi
 * e ricalcola il valore mercato. NON modifica `birthDate` né conta gli anni —
 * l'età viene dedotta da `birthDate` confrontata con la stagione corrente.
 *
 * NB: il caller (endOfSeasonAgeTick) avanza `season.year` separatamente, e il
 * `projectedAge` qui passato deve riflettere l'età che il giocatore avrà nella
 * NUOVA stagione (cioè currentAge + 1 se compirà gli anni durante la stagione,
 * ma più semplicemente: refYear = newSeasonYear).
 */
export function ageTickPlayer(player: Player, projectedAge: number, rng: Rng): void {
  const delta = effectiveAgeDelta(player, projectedAge)
  applyDeltaToAttributes(player, delta, projectedAge, rng)
  recalculateMarketValue(player)
}

// ====== Tick fine stagione (tutta la career) ======

/**
 * Avanza tutti i giocatori della career di una stagione: aging + valore.
 * Resetta `season.currentMatchday` a 1 e incrementa `season.year`.
 *
 * Va chiamato DOPO che currentMatchday > totalMatchdays (stagione conclusa).
 * Fase 3.C lo collegherà alla generazione giovani (nuove leve aggiunte qui).
 *
 * Returns: numero di giocatori processati.
 */
export function endOfSeasonAgeTick(career: Career): number {
  const newYear = career.season.year + 1
  // Rng deterministic per riproducibilità: stesso seed + anno = stessi delta
  // 0xA6E101 = magic constant per aging tick (evita collisioni con altri rng derived)
  const rng = createRng((career.seed ^ newYear ^ 0xA6E101) >>> 0)
  let processed = 0
  for (const p of Object.values(career.players)) {
    // Safety: assicura attributi FM popolati prima del tick (save legacy)
    ensurePlayerFMAttributes(p)
    const projectedAge = ageFromBirthDate(p.birthDate, newYear)
    if (projectedAge < 14) continue  // sotto i 14 anni non si tocca (saranno giovani Fase 3.C)
    ageTickPlayer(p, projectedAge, rng)
    processed++
  }
  career.season.year = newYear
  career.season.currentMatchday = 1
  career.updatedAt = Date.now()
  return processed
}
