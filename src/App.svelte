<script lang="ts">
  import Router from 'svelte-spa-router'
  import { routes } from './router'
</script>

<main class="min-h-screen stadium-bg">
  <Router {routes} />
</main>
