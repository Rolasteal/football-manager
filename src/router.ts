import type { RouteDefinition } from 'svelte-spa-router'
import Home from '$routes/Home.svelte'
import NewCareer from '$routes/NewCareer.svelte'
import Dashboard from '$routes/Dashboard.svelte'
import Squad from '$routes/Squad.svelte'
import Fixtures from '$routes/Fixtures.svelte'
import Standings from '$routes/Standings.svelte'
import Match from '$routes/Match.svelte'
import MatchReport from '$routes/MatchReport.svelte'
import PlayerDetail from '$routes/PlayerDetail.svelte'
import Settings from '$routes/Settings.svelte'
import BettingDemo from '$routes/BettingDemo.svelte'
import Stadium from '$routes/Stadium.svelte'
import Transfers from '$routes/Transfers.svelte'
import Youth from '$routes/Youth.svelte'
import NotFound from '$routes/NotFound.svelte'

export const routes: RouteDefinition = {
  '/': Home,
  '/new-career': NewCareer,
  '/dashboard':  Dashboard,
  '/squad':      Squad,
  '/fixtures':   Fixtures,
  '/standings':  Standings,
  '/match':      Match,
  '/match-report/:fixtureId': MatchReport,
  '/player/:id': PlayerDetail,
  '/stadium':    Stadium,
  '/transfers':  Transfers,
  '/youth':      Youth,
  '/settings':   Settings,
  '/betting-demo': BettingDemo,
  // Fallback 404
  '*': NotFound,
}
