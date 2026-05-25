<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { ArrowLeft, Construction } from '@lucide/svelte'
</script>

<div class="min-h-screen flex flex-col items-center justify-center px-6 py-10">
  <button onclick={() => push('/')} class="btn-outline-gold absolute top-6 left-6 py-2 px-4 text-xs">
    <ArrowLeft size={16} />
    Indietro
  </button>

  <div class="text-center max-w-xl anim-kickin">
    <div class="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-gold-500/15 to-gold-700/5 border border-gold-500/25 mb-6">
      <Construction size={36} class="text-gold-300" />
    </div>
    <h1 class="text-4xl font-black tracking-tight text-metallic text-glow-soft mb-3">Nuova Carriera</h1>
    <p class="text-onyx-300 leading-relaxed">
      Qui sceglierai nazione, lega, squadra da allenare, livello difficoltà e profilo allenatore.
      <br />
      <span class="text-gold-300 font-semibold">In arrivo nella Fase 1</span> del progetto.
    </p>
  </div>
</div>
