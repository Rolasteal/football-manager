import type { RouteDefinition } from 'svelte-spa-router'
import Home from '$routes/Home.svelte'
import NewCareer from '$routes/NewCareer.svelte'
import Settings from '$routes/Settings.svelte'
import NotFound from '$routes/NotFound.svelte'

export const routes: RouteDefinition = {
  '/': Home,
  '/new-career': NewCareer,
  '/settings': Settings,
  // Fallback 404
  '*': NotFound,
}
