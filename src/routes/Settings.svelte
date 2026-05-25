<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { ArrowLeft, Settings as Cog } from '@lucide/svelte'
</script>

<div class="min-h-screen flex flex-col items-center justify-center px-6 py-10">
  <button onclick={() => push('/')} class="btn-ghost absolute top-6 left-6">
    <ArrowLeft size={18} />
    Indietro
  </button>

  <div class="text-center max-w-xl anim-kickin">
    <Cog size={64} class="text-night-300 mx-auto mb-6" />
    <h1 class="text-4xl font-bold text-white mb-3">Impostazioni</h1>
    <p class="text-night-300 leading-relaxed">
      Lingua, audio, qualità grafica, dati salvati, gestione account.
      <br />
      <span class="text-pitch-300 font-semibold">Configurabile a partire dalla Fase 1</span>.
    </p>
  </div>
</div>
