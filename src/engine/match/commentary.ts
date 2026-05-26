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
  penalty_goal: [
    '⚽ {p} dal dischetto: rete! Gol al {min}\'!',
    '⚽ Glaciale {p}: trasforma il rigore al {min}\'!',
    '⚽ {p} non sbaglia dagli undici metri: gol al {min}\'!',
  ],
  penalty_saved: [
    '🧤 PARATA! {p2} ipnotizza {p} dal dischetto!',
    '🧤 Che paratona di {p2}: rigore neutralizzato!',
    '🧤 {p} se lo fa parare: bravo {p2}!',
  ],
  penalty_missed: [
    '😱 {p} sbaglia il rigore: pallone fuori!',
    '😱 Disastro {p}: spreca il rigore al {min}\'!',
    '😱 Tiro alle stelle di {p}: rigore sbagliato!',
  ],
  penalty_post: [
    '🟫 PALO! {p} prende il legno alla destra del portiere!',
    '🟫 Sul palo di {p}! Sfortunatissimo dal dischetto.',
    '🟫 Che sfortuna: il pallone di {p} bacia il palo!',
  ],
  penalty_crossbar: [
    '🟫 TRAVERSA! {p} colpisce in pieno il legno superiore!',
    '🟫 Sulla traversa di {p}! Pallone fuori di pochissimo.',
    '🟫 Che sfortuna: traversa piena per {p} dal dischetto!',
  ],
  penalty_high: [
    '☁️ {p} la spara alle stelle: rigore alto sopra la traversa!',
    '☁️ Tiro altissimo di {p}: rigore in curva!',
  ],
  penalty_wide: [
    '🚀 {p} calcia largo: rigore a lato!',
    '🚀 Tiro impreciso di {p}: pallone fuori sul lato.',
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
