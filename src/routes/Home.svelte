<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { Trophy, Play, Save, Settings as Cog, Sparkles } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import { hasAnySave } from '$storage/db'

  let hasSave = $state(false)
  let version = __APP_VERSION__

  onMount(async () => {
    try {
      hasSave = await hasAnySave()
    } catch {
      hasSave = false
    }
  })

  function startNew() { push('/new-career') }
  function openSettings() { push('/settings') }
  function continueGame() {
    if (!hasSave) return
    // TODO Fase 1: caricamento ultimo salvataggio
    push('/dashboard')
  }
</script>

<div class="relative min-h-screen flex flex-col items-center justify-center px-6 py-10">

  <!-- Badge versione in alto -->
  <div class="absolute top-6 left-1/2 -translate-x-1/2 anim-kickin">
    <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs uppercase tracking-widest text-night-300">
      <Sparkles size={12} class="text-trophy-400" />
      Alpha · build {version}
    </div>
  </div>

  <!-- Logo + tagline -->
  <div class="text-center max-w-3xl mx-auto">
    <div class="anim-kickin">
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-pitch-500 to-pitch-700 mb-6 shadow-[0_20px_60px_-20px_rgba(34,197,94,0.6)]">
        <Trophy size={42} class="text-trophy-300" strokeWidth={2.2} />
      </div>
    </div>

    <h1 class="anim-kickin anim-delay-100 text-6xl md:text-7xl lg:text-8xl font-black tracking-tighter leading-none">
      <span class="block text-white text-glow-pitch">FOOTBALL</span>
      <span class="block bg-gradient-to-r from-trophy-300 via-trophy-400 to-trophy-500 bg-clip-text text-transparent text-glow-trophy">MANAGER</span>
    </h1>

    <p class="anim-kickin anim-delay-200 mt-6 text-lg md:text-xl text-night-300 max-w-xl mx-auto leading-relaxed">
      Il manageriale calcistico più completo. Gratis, online,
      <span class="text-pitch-300 font-semibold">il tuo club dal primo allenamento alla Champions</span>.
    </p>
  </div>

  <!-- Bottoni azione -->
  <div class="anim-kickin anim-delay-300 mt-12 flex flex-col sm:flex-row gap-4 w-full max-w-2xl">

    <button onclick={startNew} class="btn-primary flex-1 text-lg py-4">
      <Play size={20} fill="currentColor" />
      Nuova Carriera
    </button>

    <button
      onclick={continueGame}
      disabled={!hasSave}
      class="btn-secondary flex-1 text-lg py-4 disabled:opacity-40 disabled:cursor-not-allowed"
      title={hasSave ? 'Riprendi la tua ultima partita' : 'Nessun salvataggio trovato'}
    >
      <Save size={20} />
      {hasSave ? 'Continua' : 'Nessun salvataggio'}
    </button>

    <button onclick={openSettings} class="btn-ghost px-5 py-4 sm:flex-none" aria-label="Impostazioni">
      <Cog size={22} />
    </button>
  </div>

  <!-- Anteprima feature (placeholder, riempiremo nelle prossime fasi) -->
  <div class="anim-kickin anim-delay-400 mt-20 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl w-full">
    {#each [
      { icon: '⚽', label: 'Partite live', desc: 'Timer 1\'–90\' con interruzioni gol' },
      { icon: '💰', label: 'Mercato', desc: 'Trattative, plusvalenze, agenti' },
      { icon: '🏟️', label: 'Stadio', desc: 'Costruisci settore dopo settore' },
      { icon: '📈', label: 'Finanze', desc: 'Sponsor, biglietti, bilancio' }
    ] as f}
      <div class="card-glass px-4 py-5 text-center">
        <div class="text-3xl mb-2">{f.icon}</div>
        <div class="text-sm font-semibold text-white">{f.label}</div>
        <div class="text-xs text-night-300 mt-1">{f.desc}</div>
      </div>
    {/each}
  </div>

  <!-- Footer -->
  <footer class="anim-kickin anim-delay-500 absolute bottom-4 left-0 right-0 text-center text-xs text-night-500">
    Costruito con ❤️ — open source · 100% browser · 0€ di hosting
  </footer>
</div>
