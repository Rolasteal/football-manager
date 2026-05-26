<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { careerStore } from '$state/career.svelte'
  import type { Snippet } from 'svelte'
  import { onMount, onDestroy } from 'svelte'

  interface Props { children: Snippet }
  let { children }: Props = $props()

  const store = careerStore()
  let career = $derived(store.career)
  let myTeam = $derived(career ? career.teams[career.club.teamId] : null)

  const NAV = [
    { to: '/dashboard',  label: 'Dashboard',  icon: '🏠' },
    { to: '/squad',      label: 'Rosa',       icon: '👥' },
    { to: '/fixtures',   label: 'Calendario', icon: '📅' },
    { to: '/standings',  label: 'Classifica', icon: '🏆' },
    { to: '/stadium',    label: 'Stadio',     icon: '🏟️' },
  ]

  // svelte-spa-router usa hash routing. Path corrente = hash senza il "#".
  let currentPath = $state('/')

  function syncHash() {
    const h = window.location.hash.slice(1) || '/'
    currentPath = h
  }
  onMount(() => {
    syncHash()
    window.addEventListener('hashchange', syncHash)
  })
  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('hashchange', syncHash)
  })

  function navigate(path: string) { push(path) }
</script>

<div class="shell stadium-bg">
  <header class="topbar">
    <button class="brand" onclick={() => navigate('/dashboard')}>
      <span class="logo-dot"></span>
      <span class="brand-name">Football Manager</span>
    </button>

    {#if career && myTeam}
      <div class="club-badge" title={myTeam.name}>
        <span class="crest" style="--c1: {myTeam.primaryColor}; --c2: {myTeam.secondaryColor};">{myTeam.shortName}</span>
        <div class="club-info">
          <div class="club-name">{myTeam.name}</div>
          <div class="club-meta">Stagione {career.season.year}/{career.season.year + 1} · Giornata {career.season.currentMatchday}</div>
        </div>
      </div>
    {/if}

    <span class="grow"></span>

    <button class="btn-ghost" onclick={() => navigate('/settings')} aria-label="Impostazioni" title="Impostazioni">⚙</button>
    <button class="btn-ghost" onclick={() => navigate('/')} aria-label="Esci alla home" title="Esci alla home">⏏</button>
  </header>

  <aside class="sidebar">
    <nav>
      {#each NAV as item}
        <button
          class="nav-item"
          class:active={currentPath === item.to}
          onclick={() => navigate(item.to)}
        >
          <span class="icon">{item.icon}</span>
          <span class="label">{item.label}</span>
        </button>
      {/each}
    </nav>
  </aside>

  <main class="main">
    {@render children()}
  </main>
</div>

<style>
  .shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 240px 1fr;
    grid-template-rows: 70px 1fr;
    grid-template-areas:
      "topbar topbar"
      "sidebar main";
    color: #fef3c7;
  }

  .topbar {
    grid-area: topbar;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 24px;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(252, 211, 77, 0.18);
    z-index: 10;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    background: none;
    border: 0;
    color: inherit;
    cursor: pointer;
    font-family: inherit;
  }
  .logo-dot {
    width: 14px; height: 14px;
    border-radius: 50%;
    background: linear-gradient(180deg, #fde68a, #f59e0b 60%, #b45309);
    box-shadow: 0 0 12px rgba(245, 158, 11, 0.55);
  }
  .brand-name {
    font-weight: 800;
    letter-spacing: 0.05em;
    font-size: 14px;
    text-transform: uppercase;
  }

  .club-badge {
    display: flex; align-items: center; gap: 10px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(252, 211, 77, 0.2);
    border-radius: 10px;
    padding: 6px 14px 6px 6px;
    margin-left: 20px;
  }
  .crest {
    width: 36px; height: 36px; flex-shrink: 0;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff;
    font-weight: 800; font-size: 11px;
    display: flex; align-items: center; justify-content: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }
  .club-info { min-width: 0; }
  .club-name {
    font-weight: 700; font-size: 13px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 240px;
  }
  .club-meta { color: #918778; font-size: 10px; letter-spacing: 0.05em; }
  .grow { flex: 1; }

  .sidebar {
    grid-area: sidebar;
    background: rgba(0, 0, 0, 0.5);
    border-right: 1px solid rgba(252, 211, 77, 0.12);
    padding: 16px 12px;
  }
  nav { display: flex; flex-direction: column; gap: 4px; }
  .nav-item {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 14px;
    background: none;
    border: 1px solid transparent;
    color: #c8bfa8;
    cursor: pointer;
    border-radius: 10px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    transition: all 0.15s ease;
  }
  .nav-item .icon { font-size: 16px; opacity: 0.85; }
  .nav-item:hover {
    background: rgba(252, 211, 77, 0.08);
    color: #fef3c7;
    border-color: rgba(252, 211, 77, 0.2);
  }
  .nav-item.active {
    background: linear-gradient(90deg, rgba(252, 211, 77, 0.2), rgba(252, 211, 77, 0.05));
    color: #fef3c7;
    border-color: rgba(252, 211, 77, 0.5);
    box-shadow: inset 3px 0 0 #fcd34d;
  }

  .main {
    grid-area: main;
    padding: 28px clamp(20px, 3vw, 40px) 60px;
    overflow-y: auto;
    min-width: 0;
  }

  @media (max-width: 720px) {
    .shell {
      grid-template-columns: 1fr;
      grid-template-rows: 70px auto 1fr;
      grid-template-areas:
        "topbar"
        "sidebar"
        "main";
    }
    .sidebar { padding: 8px; border-right: 0; border-bottom: 1px solid rgba(252, 211, 77, 0.12); }
    nav { flex-direction: row; overflow-x: auto; }
    .nav-item { white-space: nowrap; }
    .club-badge .club-meta { display: none; }
    .club-name { max-width: 120px; }
  }
</style>
