<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { ArrowLeft, Construction } from '@lucide/svelte'
</script>

<div class="min-h-screen flex flex-col items-center justify-center px-6 py-10">
  <button onclick={() => push('/')} class="btn-ghost absolute top-6 left-6">
    <ArrowLeft size={18} />
    Indietro
  </button>

  <div class="text-center max-w-xl anim-kickin">
    <Construction size={64} class="text-trophy-400 mx-auto mb-6" />
    <h1 class="text-4xl font-bold text-white mb-3">Nuova Carriera</h1>
    <p class="text-night-300 leading-relaxed">
      Qui sceglierai nazione, lega, squadra da allenare, livello difficoltà e profilo allenatore.
      <br />
      <span class="text-pitch-300 font-semibold">In arrivo nella Fase 1</span> del progetto.
    </p>
  </div>
</div>
