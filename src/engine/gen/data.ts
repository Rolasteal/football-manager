/**
 * Dataset di base per la generazione procedurale.
 *
 * ⚠️ Tutto qui dentro DEVE essere fittizio / generico.
 * Niente nomi di calciatori reali, niente nomi di squadre o leghe reali.
 * I cognomi sono cognomi comuni italiani della popolazione generale,
 * non riferiti a personaggi pubblici specifici.
 */

// ====== Nomi propri maschili (italiani comuni) ======
export const FIRST_NAMES: readonly string[] = [
  'Alessandro', 'Andrea', 'Antonio', 'Carlo', 'Claudio', 'Daniele', 'Davide',
  'Diego', 'Edoardo', 'Emanuele', 'Enrico', 'Fabio', 'Federico', 'Filippo',
  'Francesco', 'Gabriele', 'Giacomo', 'Giorgio', 'Giovanni', 'Giulio',
  'Giuseppe', 'Leonardo', 'Lorenzo', 'Luca', 'Luigi', 'Marco', 'Mario',
  'Massimo', 'Matteo', 'Mattia', 'Michele', 'Nicola', 'Paolo', 'Pietro',
  'Riccardo', 'Roberto', 'Salvatore', 'Samuele', 'Sergio', 'Simone',
  'Stefano', 'Tommaso', 'Umberto', 'Valerio', 'Vincenzo', 'Vittorio',
  'Alberto', 'Aldo', 'Angelo', 'Bruno', 'Cesare', 'Cristian', 'Damiano',
  'Dario', 'Elia', 'Ettore', 'Fausto', 'Flavio', 'Gennaro', 'Gianluca',
  'Ivan', 'Jacopo', 'Loris', 'Manuel', 'Manuele', 'Marcello', 'Maurizio',
  'Nicolò', 'Patrizio', 'Raffaele', 'Renato', 'Sandro', 'Silvio', 'Tiziano'
]

// ====== Cognomi italiani comuni ======
// Cognomi diffusi nella popolazione, non riconducibili a un singolo calciatore famoso.
export const LAST_NAMES: readonly string[] = [
  'Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo',
  'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca',
  'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri',
  'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Galli',
  'Martini', 'Leone', 'Longo', 'Gentile', 'Martinelli', 'Vitale', 'Lombardo',
  'Serra', 'Coppola', 'De Santis', 'D\'Angelo', 'Marchetti', 'Parisi',
  'Villa', 'Conte', 'Ferraro', 'Ferri', 'Fabbri', 'Bianco', 'Marini',
  'Grassi', 'Valentini', 'Messina', 'Sala', 'De Angelis', 'Gatti',
  'Pellegrini', 'Palumbo', 'Sanna', 'Farina', 'Rizzi', 'Monti', 'Cattaneo',
  'Morelli', 'Amato', 'Silvestri', 'Mazza', 'Testa', 'Grasso', 'Pellegrino',
  'Carbone', 'Giuliani', 'Benedetti', 'Barone', 'Rossetti', 'Caputo',
  'Montanari', 'Guerra', 'Palmieri', 'Bernardi', 'Martino', 'Fiore',
  'De Rosa', 'Castelli', 'Bellini', 'Olivieri', 'Piras', 'Donati',
  'Sorrentino', 'Marra', 'Cattani', 'Negri', 'Pace', 'Carlini', 'Orlando',
  'Pagano', 'Ruggiero', 'Cocco', 'Vitiello', 'Catalano', 'Albanese',
  'Basile', 'Ferretti', 'Bertolini', 'Neri', 'Sartori', 'Battaglia',
  'Costantini', 'Cossu', 'Carta', 'Bassi', 'Marchi', 'Pasquali'
]

// ====== Città italiane fittizie ======
// Combinazione di prefissi + radici comuni nei toponimi italiani.
// Mai una città reale specifica (no Roma, Milano, Torino…).
export const CITY_PREFIXES: readonly string[] = [
  'San', 'Santa', 'Castel', 'Borgo', 'Monte', 'Villa', 'Poggio', 'Rocca',
  'Pieve', 'Colle', 'Forte', 'Marina di', 'Sasso', 'Cima', 'Bagno'
]
export const CITY_ROOTS: readonly string[] = [
  'Marziano', 'Valerano', 'Pievelta', 'Rovere', 'Faldo', 'Vivaro',
  'Trezzano', 'Verdone', 'Pradalbino', 'Calvario', 'Brento', 'Asciano',
  'Murello', 'Stellato', 'Bagnara', 'Casaleno', 'Salvio', 'Forteglia',
  'Ronchino', 'Vivaldo', 'Conturbia', 'Pratacchio', 'Tornello', 'Velleia',
  'Ortona', 'Vellano', 'Casebianche', 'Solvica', 'Caprano', 'Belluno-Nuovo',
  'Cassanio', 'Veneranda', 'Galliano', 'Pignola', 'Ostiglia-Nuova',
  'Roccaverde', 'Sabbiola', 'Tremezzano', 'Vallerana', 'Spinaccio',
  'Marmorina', 'Cortebella', 'Foglienna', 'Lagosanto', 'Pratoselva',
  'Riomanto', 'Sarzeno', 'Tortona-Vecchia', 'Vellanico', 'Zibellino'
]

// ====== Suffissi / prefissi nome squadra ======
export const TEAM_PREFIXES: readonly string[] = [
  'FC', 'AC', 'AS', 'US', 'SS', 'SC', 'Atletico', 'Sporting',
  'Real', 'Nuova', 'Polisportiva', 'Calcio', 'Unione'
]
export const TEAM_SUFFIXES: readonly string[] = [
  'Calcio', 'FC', '1908', '1912', '1923', '1947', '1956', 'Sportiva',
  'United', 'City', ''
]

/** Probabilità di avere prefisso (vs solo "Nome Calcio") */
export const TEAM_PREFIX_PROB = 0.6
/** Probabilità di avere suffisso */
export const TEAM_SUFFIX_PROB = 0.5

// ====== Palette colori club ======
// Coppie [primario, secondario] in hex
export const TEAM_COLORS: readonly [string, string][] = [
  ['#dc2626', '#fef3c7'],  // rosso/oro
  ['#1d4ed8', '#ffffff'],  // blu/bianco
  ['#000000', '#ffffff'],  // nero/bianco
  ['#15803d', '#ffffff'],  // verde/bianco
  ['#7c3aed', '#fbbf24'],  // viola/oro
  ['#0891b2', '#000000'],  // azzurro/nero
  ['#ca8a04', '#1e1b4b'],  // oro/blu scuro
  ['#dc2626', '#1e3a8a'],  // rosso/blu (granata)
  ['#16a34a', '#000000'],  // verde/nero
  ['#fbbf24', '#000000'],  // giallo/nero
  ['#be123c', '#fef2f2'],  // bordeaux/rosa
  ['#0f766e', '#fef3c7'],  // teal/crema
  ['#9333ea', '#ffffff'],  // viola/bianco
  ['#ea580c', '#1c1917'],  // arancio/nero
  ['#1e40af', '#fbbf24'],  // blu/oro
  ['#7f1d1d', '#fafaf9'],  // bordeaux/avorio
  ['#0c4a6e', '#fef9c3'],  // navy/giallo
  ['#831843', '#fdf2f8'],  // magenta scuro/rosa
  ['#65a30d', '#ffffff'],  // lime/bianco
  ['#475569', '#facc15'],  // grigio/oro
]

// ====== Nomi stadi (toponimo + tipo) ======
export const STADIUM_TYPES: readonly string[] = [
  'Stadio Comunale', 'Stadio Olimpico', 'Stadio',
  'Arena', 'Centro Sportivo', 'Stadio Cittadino',
  'Campo Sportivo', 'Stadio del Popolo'
]
/** Patroni / dedicatari per i nomi stadi (fittizi, no persone reali) */
export const STADIUM_DEDICATEES: readonly string[] = [
  'Aurelio Velleti', 'Gianfranco Astrolfi', 'Pietro Manzaroli',
  'Cesare Vivaldini', 'Ottavio Spinacci', 'Romano Pellegrini',
  'Alceste Marcantoni', 'Sergio Vallenari', 'Olindo Tornanti',
  'Giorgio Salvietti', 'Renato Pianelli', 'Mauro Foschini'
]
