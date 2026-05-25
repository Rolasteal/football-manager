<!--
  Ornamento decorativo: trofeo dorato circondato da stelle e ramoscelli.
  SVG inline così possiamo gestire colori/animazioni via CSS.
  Quando Roberto fornirà un asset PNG migliore (ChatGPT Image 2),
  basterà sostituire questo componente.
-->
<script lang="ts">
  interface Props {
    size?: number
  }
  let { size = 140 }: Props = $props()
</script>

<div class="relative inline-flex" style="width:{size}px; height:{size}px;">
  <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
    <defs>
      <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#fef3c7"/>
        <stop offset="35%"  stop-color="#fcd34d"/>
        <stop offset="65%"  stop-color="#f59e0b"/>
        <stop offset="100%" stop-color="#b45309"/>
      </linearGradient>
      <linearGradient id="goldGradDark" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#fcd34d"/>
        <stop offset="100%" stop-color="#92400e"/>
      </linearGradient>
      <radialGradient id="goldGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stop-color="#fbbf24" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
      </radialGradient>
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.5"/>
        <feOffset dy="2"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>

    <!-- Glow di sfondo -->
    <circle cx="100" cy="100" r="90" fill="url(#goldGlow)"/>

    <!-- Stelle decorative -->
    <g fill="url(#goldGrad)" class="anim-pulse-gold">
      <!-- Stella centrale grande sopra -->
      <path d="M100 18 L104 30 L116 30 L106 38 L110 50 L100 42 L90 50 L94 38 L84 30 L96 30 Z"/>
    </g>
    <g fill="url(#goldGradDark)" opacity="0.85">
      <!-- Stelle laterali piccole -->
      <path d="M62 32 L64 38 L70 38 L65 42 L67 48 L62 44 L57 48 L59 42 L54 38 L60 38 Z"/>
      <path d="M138 32 L140 38 L146 38 L141 42 L143 48 L138 44 L133 48 L135 42 L130 38 L136 38 Z"/>
    </g>

    <!-- Ramoscelli (foglie d'alloro) -->
    <g fill="url(#goldGradDark)" opacity="0.9" filter="url(#softShadow)">
      <!-- Sinistro -->
      <path d="M52 110 Q40 130 50 158 Q60 150 64 138 Q56 130 52 110 Z"/>
      <path d="M52 110 Q42 100 38 86 Q48 90 56 102 Z" opacity="0.85"/>
      <!-- Destro -->
      <path d="M148 110 Q160 130 150 158 Q140 150 136 138 Q144 130 148 110 Z"/>
      <path d="M148 110 Q158 100 162 86 Q152 90 144 102 Z" opacity="0.85"/>
    </g>

    <!-- Trofeo -->
    <g filter="url(#softShadow)">
      <!-- Coppa (corpo) -->
      <path d="M80 70 Q72 70 72 80 L72 100 Q72 120 100 128 Q128 120 128 100 L128 80 Q128 70 120 70 Z"
            fill="url(#goldGrad)"
            stroke="#92400e" stroke-width="1.2"/>
      <!-- Manici -->
      <path d="M72 80 Q58 84 58 96 Q58 106 72 102" fill="none" stroke="url(#goldGradDark)" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M128 80 Q142 84 142 96 Q142 106 128 102" fill="none" stroke="url(#goldGradDark)" stroke-width="3.5" stroke-linecap="round"/>
      <!-- Riflesso luce su coppa -->
      <path d="M82 76 Q80 88 86 104" fill="none" stroke="#fef3c7" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
      <!-- Stelo -->
      <rect x="94" y="128" width="12" height="14" fill="url(#goldGradDark)"/>
      <!-- Base -->
      <rect x="78" y="142" width="44" height="8" rx="2" fill="url(#goldGrad)" stroke="#92400e" stroke-width="1"/>
      <rect x="72" y="150" width="56" height="6" rx="2" fill="url(#goldGradDark)" stroke="#451a03" stroke-width="0.8"/>
    </g>
  </svg>
</div>
