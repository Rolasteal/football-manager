<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { Home } from '@lucide/svelte'
</script>

<div class="min-h-screen flex flex-col items-center justify-center px-6 py-10 text-center">
  <div class="anim-kickin">
    <div class="text-[10rem] leading-none font-black text-gold text-glow-gold">404</div>
    <h1 class="mt-4 text-3xl font-black tracking-tight text-metallic text-glow-soft">Fuori dal campo!</h1>
    <p class="mt-3 text-onyx-300 max-w-md mx-auto">La pagina che cercavi è andata in panchina. Torniamo nello spogliatoio?</p>
    <button onclick={() => push('/')} class="btn-gold mt-8">
      <Home size={18} />
      Torna alla home
    </button>
  </div>
</div>
