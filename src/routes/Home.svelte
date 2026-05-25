<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { Play, Save, Settings as Cog, Gift, Cloud, Sparkles, Goal, Coins, Building2, TrendingUp } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import { hasAnySave } from '$storage/db'
  import TrophyOrnament from '$lib/TrophyOrnament.svelte'

  let hasSave = $state(false)
  let version = __APP_VERSION__

  onMount(async () => {
    try { hasSave = await hasAnySave() } catch { hasSave = false }
  })

  function startNew() { push('/new-career') }
  function openSettings() { push('/settings') }
  function continueGame() {
    if (!hasSave) return
    push('/dashboard') // TODO Fase 1
  }

  const features = [
    { icon: Goal,        label: 'Partite Live', desc: "Timer 1'–90' con interruzioni gol\ne commento dinamico." },
    { icon: Coins,       label: 'Mercato',      desc: 'Trattative, plusvalenze,\nagenti e osservatori.' },
    { icon: Building2,   label: 'Stadio',       desc: 'Costruisci e potenzia\nil tuo impianto.' },
    { icon: TrendingUp,  label: 'Finanze',      desc: 'Sponsor, biglietti, bilancio\ne sostenibilità.' },
  ] as const
</script>

<div class="relative min-h-screen overflow-hidden">

  <!-- ============ TOP BAR ============ -->
  <header class="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-6 md:px-10 py-6 anim-kickin">
    <!-- Badge versione -->
    <div class="chip-gold">
      <Sparkles size={11} class="text-gold-300" />
      Alpha · build {version}
    </div>

    <!-- Nav icons -->
    <nav class="flex items-center gap-2.5">
      <button class="btn-ghost" aria-label="Novità e regali" title="Novità">
        <Gift size={18} />
      </button>
      <button class="btn-ghost" aria-label="Sincronizzazione cloud" title="Cloud sync (presto)">
        <Cloud size={18} />
      </button>
      <button class="btn-ghost" aria-label="Impostazioni" onclick={openSettings}>
        <Cog size={18} />
      </button>
    </nav>
  </header>

  <!-- ============ HERO ============ -->
  <main class="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 pt-32 pb-12">

    <!-- Trofeo ornamentale -->
    <div class="anim-kickin">
      <TrophyOrnament size={160} />
    </div>

    <!-- Titolo doppio gradient -->
    <h1 class="anim-kickin anim-delay-100 mt-4 text-center font-black tracking-tighter leading-[0.85] select-none">
      <span class="block text-metallic text-glow-soft text-[clamp(3.5rem,11vw,8.5rem)]">FOOTBALL</span>
      <span class="block text-gold text-glow-gold text-[clamp(3.5rem,11vw,8.5rem)] -mt-2">MANAGER</span>
    </h1>

    <!-- Separatore stelle -->
    <div class="anim-kickin anim-delay-200 mt-6 flex items-center gap-3 text-gold-500/70">
      <span class="block w-12 h-px bg-gradient-to-r from-transparent to-gold-500/60"></span>
      <span class="text-xs">★ ★ ★</span>
      <span class="block w-12 h-px bg-gradient-to-l from-transparent to-gold-500/60"></span>
    </div>

    <!-- Sottotitolo -->
    <p class="anim-kickin anim-delay-300 mt-5 max-w-2xl text-center text-base md:text-lg text-onyx-300 leading-relaxed">
      Il manageriale calcistico più completo.<br />
      Gratis, online, <span class="text-gold-300 font-semibold">il tuo club</span> dal primo allenamento alla <span class="text-gold-300 font-semibold">Champions</span>.
    </p>

    <!-- Bottoni azione -->
    <div class="anim-kickin anim-delay-400 mt-9 flex flex-col sm:flex-row gap-3 w-full max-w-xl">
      <button onclick={startNew} class="btn-gold flex-1">
        <Play size={18} fill="currentColor" />
        Nuova Carriera
      </button>

      <button
        onclick={continueGame}
        disabled={!hasSave}
        class="btn-outline-gold flex-1"
        title={hasSave ? 'Riprendi la tua ultima partita' : 'Nessun salvataggio trovato'}
      >
        <Save size={18} />
        {hasSave ? 'Continua' : 'Nessun salvataggio'}
      </button>
    </div>

    <!-- 4 card features -->
    <section class="anim-kickin anim-delay-500 mt-20 grid grid-cols-2 lg:grid-cols-4 gap-3 max-w-5xl w-full">
      {#each features as f}
        <div class="card-gold card-gold-hover p-5 text-center">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-gold-500/15 to-gold-700/5 border border-gold-500/20 mb-3">
            <f.icon size={22} class="text-gold-300" strokeWidth={2} />
          </div>
          <div class="text-sm font-bold tracking-wider uppercase text-gold-200">{f.label}</div>
          <div class="mt-1.5 text-xs text-onyx-400 leading-relaxed whitespace-pre-line">{f.desc}</div>
        </div>
      {/each}
    </section>

    <!-- Footer -->
    <footer class="anim-kickin anim-delay-600 mt-14 text-center text-xs text-onyx-500">
      Costruito con <span class="text-gold-400">♥</span> · open source · 100% browser · 0€ di hosting
    </footer>
  </main>
</div>
