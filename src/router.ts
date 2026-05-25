import type { RouteDefinition } from 'svelte-spa-router'
import Home from '$routes/Home.svelte'
import NewCareer from '$routes/NewCareer.svelte'
import Dashboard from '$routes/Dashboard.svelte'
import Squad from '$routes/Squad.svelte'
import Fixtures from '$routes/Fixtures.svelte'
import Standings from '$routes/Standings.svelte'
import Match from '$routes/Match.svelte'
import Settings from '$routes/Settings.svelte'
import NotFound from '$routes/NotFound.svelte'

export const routes: RouteDefinition = {
  '/': Home,
  '/new-career': NewCareer,
  '/dashboard':  Dashboard,
  '/squad':      Squad,
  '/fixtures':   Fixtures,
  '/standings':  Standings,
  '/match':      Match,
  '/settings':   Settings,
  // Fallback 404
  '*': NotFound,
}
