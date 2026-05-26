/**
 * Backward-compat per save legacy creati prima della Fase 3.A.
 *
 * I save vecchi hanno solo i 15 attributi flat (passing/shooting/...) e nessun
 * `potential`. Questo modulo popola gli attributi FM mancanti via mappatura
 * deterministica dai vecchi attributi, idempotente (se già presenti non sovrascrive).
 *
 * Pattern uguale a `ensureClubFinances` (Fase 3.1) e `ensureBettingData` (Fase 7):
 * chiamato lazy nei punti di lettura (PlayerDetail, engine match futuro che usa FM).
 */

import type { Player, PlayerAttributes } from '$engine/types'
import { calcOverall } from './player'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(n)))
}

function clampAttr(n: number): number {
  return clamp(n, 1, 20)
}

/**
 * Calcola età dal birthDate ISO. Stagione di riferimento opzionale (default oggi).
 * Usata per stimare `potential` mancante.
 */
function ageFromBirthDate(birthDate: string, refYear?: number): number {
  const birth = new Date(birthDate)
  const ref = refYear ?? new Date().getUTCFullYear()
  return ref - birth.getUTCFullYear()
}

/**
 * Popola gli attributi FM mancanti partendo dai legacy. Idempotente.
 * Mappa ogni nuovo attributo FM al proxy più sensato tra i 15 vecchi.
 * Il risultato non sarà esattamente identico a un giocatore generato ex novo
 * (i nuovi avranno più varianza), ma è una base solida e deterministica.
 */
export function ensurePlayerFMAttributes(p: Player): void {
  const a = p.attributes as PlayerAttributes & Record<string, number | undefined>
  const isGK = p.position === 'GK'

  // ===== TECHNICAL FM =====
  if (a.corners === undefined) a.corners = clampAttr(a.crossing)
  if (a.firstTouch === undefined) a.firstTouch = clampAttr((a.passing + a.composure) / 2)
  if (a.freeKicks === undefined) a.freeKicks = clampAttr((a.passing + (a.shooting || a.finishing)) / 2)
  if (a.longShots === undefined) a.longShots = clampAttr(a.shooting)
  if (a.longThrows === undefined) a.longThrows = clampAttr(a.strength * 0.6 + 4)
  if (a.marking === undefined) a.marking = clampAttr(a.tackling)
  if (a.penaltyTaking === undefined) a.penaltyTaking = clampAttr(a.finishing * 0.9)
  if (a.technique === undefined) a.technique = clampAttr((a.passing + a.dribbling) / 2)

  // ===== MENTAL FM =====
  if (a.aggression === undefined) {
    a.aggression = clampAttr(p.position === 'CB' || p.position === 'DM' ? (a.workRate + a.tackling) / 2 : a.workRate * 0.8 + 3)
  }
  if (a.anticipation === undefined) a.anticipation = clampAttr(a.vision)
  if (a.bravery === undefined) a.bravery = clampAttr(a.workRate)
  if (a.concentration === undefined) a.concentration = clampAttr(a.composure)
  if (a.decisions === undefined) a.decisions = clampAttr(a.vision)
  if (a.determination === undefined) a.determination = clampAttr(a.workRate)
  if (a.flair === undefined) a.flair = clampAttr(a.dribbling)
  if (a.leadership === undefined) a.leadership = clampAttr(a.composure)
  if (a.offTheBall === undefined) a.offTheBall = clampAttr(isGK ? a.composure : a.workRate)
  if (a.positioning === undefined) a.positioning = clampAttr(isGK ? a.handling : a.vision)
  if (a.teamwork === undefined) a.teamwork = clampAttr(a.workRate)

  // ===== PHYSICAL FM =====
  if (a.acceleration === undefined) a.acceleration = clampAttr(a.pace)
  if (a.agility === undefined) a.agility = clampAttr((a.pace + a.dribbling) / 2)
  if (a.balance === undefined) a.balance = clampAttr((a.strength + a.pace * 0.5) / 1.5)
  if (a.jumpingReach === undefined) a.jumpingReach = clampAttr(a.heading)
  if (a.naturalFitness === undefined) a.naturalFitness = clampAttr(a.stamina)

  // ===== GOALKEEPING FM =====
  if (a.aerialReach === undefined) a.aerialReach = clampAttr(a.handling)
  if (a.commandOfArea === undefined) a.commandOfArea = clampAttr(a.handling - 1)
  if (a.communication === undefined) a.communication = clampAttr(a.composure)
  if (a.eccentricity === undefined) a.eccentricity = 10  // neutro: 10 = "normale"
  if (a.kicking === undefined) a.kicking = clampAttr(a.strength)
  if (a.oneOnOnes === undefined) a.oneOnOnes = clampAttr(a.reflexes)
  if (a.punchingTendency === undefined) a.punchingTendency = 10  // neutro
  if (a.rushingOutTendency === undefined) a.rushingOutTendency = 10  // neutro
  if (a.throwing === undefined) a.throwing = clampAttr(a.strength * 0.7 + 3)

  // ===== POTENTIAL nascosto =====
  if (p.potential === undefined) {
    const currentOvr = calcOverall(p)
    const age = ageFromBirthDate(p.birthDate)
    let growthRoom: number
    if (age < 20) growthRoom = 12
    else if (age < 23) growthRoom = 7
    else if (age < 26) growthRoom = 3
    else if (age <= 28) growthRoom = 1
    else growthRoom = Math.round((age - 28) * 1.5)  // veterano: potential = peak storico
    p.potential = clamp(currentOvr + growthRoom, 30, 99)
  }
}

/**
 * Variante che gira su tutto il dizionario players di una career.
 * Idempotente, safe da chiamare in app boot o lazy in $derived.
 */
export function ensureAllPlayersFMAttributes(players: Record<string, Player>): void {
  for (const p of Object.values(players)) {
    ensurePlayerFMAttributes(p)
  }
}
