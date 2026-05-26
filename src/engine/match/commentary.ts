/**
 * Pool di template per commentari testuali in italiano.
 * I template usano placeholder che il commentator sostituisce:
 *  {p}  = nome breve giocatore (Nome Cognome o Cognome)
 *  {p2} = secondo giocatore (assistman, fallato)
 *  {t}  = nome squadra
 *  {min}= minuto
 */

export const TPL = {
  kickoff: [
    'Si parte! L\'arbitro fischia: comincia la partita.',
    'Calcio d\'inizio: la sfida ha inizio.',
    'Pallone al centro, si parte!',
  ],
  half_time: [
    'L\'arbitro manda le squadre negli spogliatoi: fine primo tempo.',
    'Finisce il primo tempo, intervallo.',
  ],
  second_half_start: [
    'Si torna in campo per la seconda frazione.',
    'Riparte la partita.',
  ],
  full_time: [
    'Triplice fischio: la partita è finita!',
    'Finisce qui: l\'arbitro fischia tre volte.',
  ],
  goal: [
    '⚽ GOOOOL! {p} insacca al {min}\'! Stadio in delirio!',
    '⚽ {p} non sbaglia: rete al {min}\'!',
    '⚽ Esplode la gioia: {p} firma il gol al {min}\'!',
    '⚽ Che zampata di {p}! Rete al {min}\'!',
    '⚽ {p} la mette dentro al {min}\'! Boato del pubblico!',
  ],
  goal_with_assist: [
    '⚽ {p} segna al {min}\' su assist di {p2}!',
    '⚽ Combinazione perfetta: {p2} per {p}, rete al {min}\'!',
    '⚽ {p2} pesca {p} in area, gol al {min}\'!',
  ],
  shot_on_target: [
    '{p} ci prova: tiro in porta!',
    'Conclusione di {p} verso lo specchio.',
    '{p} calcia: la palla è angolata.',
  ],
  shot_off: [
    'Tiro di {p}, fuori di un soffio.',
    '{p} spara alto sopra la traversa.',
    '{p} prova la conclusione, ma è larga.',
  ],
  save: [
    'Grande parata del portiere su {p}!',
    'Il portiere blocca il tiro di {p}.',
    'Bel riflesso: il portiere dice no a {p}.',
  ],
  yellow_card: [
    '🟨 Cartellino giallo per {p}.',
    '🟨 Ammonito {p} per fallo.',
    '🟨 L\'arbitro estrae il giallo: {p}.',
  ],
  red_card: [
    '🟥 ROSSO DIRETTO per {p}! Brutto fallo: espulso!',
    '🟥 {p} viene cacciato dal campo per condotta violenta!',
    '🟥 L\'arbitro non esita: rosso diretto a {p}!',
  ],
  red_card_second_yellow: [
    '🟨🟥 Secondo giallo per {p}: espulso!',
    '🟨🟥 {p} doppia ammonizione, deve lasciare il campo.',
    '🟨🟥 Doppio giallo per {p}: fuori, {t} in dieci!',
  ],
  penalty_awarded: [
    '⚖️ RIGORE! L\'arbitro indica il dischetto: fallo su {p2}!',
    '⚖️ Calcio di rigore! Atterrato {p2} in area, niente da fare per {p}.',
    '⚖️ L\'arbitro fischia: è rigore per {t}!',
  ],
  // === Rigore SEGNATO — stile ===
  penalty_goal_top_left: [
    '⚽ {p} all\'incrocio sinistro: imparabile dagli undici metri!',
    '⚽ Bordata di {p}: incrocio sinistro, gol al {min}\'!',
  ],
  penalty_goal_top_right: [
    '⚽ {p} all\'incrocio destro: il portiere non può nulla!',
    '⚽ {p} pesca l\'incrocio destro: rigore trasformato al {min}\'!',
  ],
  penalty_goal_low_left: [
    '⚽ {p} rasoterra a sinistra: angolo basso, gol al {min}\'!',
    '⚽ Conclusione precisa di {p}: rasoterra sinistro, rete!',
  ],
  penalty_goal_low_right: [
    '⚽ {p} rasoterra a destra: portiere battuto al {min}\'!',
    '⚽ {p} angola sul basso destra: rigore in fondo al sacco!',
  ],
  penalty_goal_chip: [
    '⚽ CUCCHIAIO CENTRALE! Che freddezza di {p} al {min}\'!',
    '⚽ {p} prova il pallonetto centrale: gol di pura classe!',
    '⚽ Cucchiaio di {p}: il portiere si tuffa, palla in mezzo!',
  ],
  // === Rigore PARATO ===
  penalty_saved_left: [
    '🧤 PARATONA! {p2} si distende a sinistra e respinge il tiro di {p}!',
    '🧤 {p2} vola alla sua sinistra: rigore neutralizzato!',
  ],
  penalty_saved_right: [
    '🧤 PARATONA! {p2} si tuffa a destra e dice no a {p}!',
    '🧤 {p2} indovina l\'angolo destro: rigore parato!',
  ],
  penalty_saved_center: [
    '🧤 {p2} resta al centro e blocca il tiro di {p}: cuore in gola!',
    '🧤 Tiro centrale di {p}: facile preda di {p2}.',
  ],
  // === Rigore MANCATO (fuori) ===
  penalty_miss_high: [
    '☁️ {p} la spara alle stelle: rigore alto sopra la traversa!',
    '☁️ Tiro altissimo di {p}: rigore in curva!',
  ],
  penalty_miss_wide_left: [
    '🚀 {p} calcia largo a sinistra: rigore a lato!',
    '🚀 Tiro impreciso di {p}: pallone fuori a sinistra.',
  ],
  penalty_miss_wide_right: [
    '🚀 {p} calcia largo a destra: rigore a lato!',
    '🚀 Tiro impreciso di {p}: pallone fuori a destra.',
  ],
  penalty_miss_post: [
    '🟫 PALO! {p} prende il legno alla destra del portiere!',
    '🟫 Sul palo di {p}! Sfortunatissimo dal dischetto.',
    '🟫 Che sfortuna: il pallone di {p} bacia il palo!',
  ],
  penalty_miss_crossbar: [
    '🟫 TRAVERSA! {p} colpisce in pieno il legno superiore!',
    '🟫 Sulla traversa di {p}! Pallone fuori di pochissimo.',
    '🟫 Che sfortuna: traversa piena per {p} dal dischetto!',
  ],
  foul: [
    'Fallo di {p} su {p2}.',
    'Intervento falloso di {p}.',
    'Fischio dell\'arbitro: punizione su fallo di {p}.',
  ],
  corner: [
    'Calcio d\'angolo per {t}.',
    'Concesso un corner a {t}.',
  ],
  free_kick: [
    'Punizione interessante per {t}.',
    '{t} guadagna una punizione dal limite.',
  ],
  substitution: [
    '🔄 Cambio: esce {p}, entra {p2}.',
    '🔄 Sostituzione: dentro {p2} al posto di {p}.',
  ],
  injury: [
    '🚑 {p} resta a terra: sembra un problema fisico.',
    '🚑 Si ferma {p}, entrano i sanitari.',
  ],
  filler: [  // momenti vuoti per ritmo
    'Possesso palla in mezzo al campo.',
    '{t} muove la palla con pazienza.',
    'Fase di studio tra le due squadre.',
    'Pressing alto di {t}.',
    'Ritmo che si abbassa in mezzo al campo.',
    '{t} prova a costruire dal basso.',
  ],
} as const

export type TplKey = keyof typeof TPL
