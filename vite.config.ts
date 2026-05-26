import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, 'src/lib'),
      $engine: path.resolve(__dirname, 'src/engine'),
      $routes: path.resolve(__dirname, 'src/routes'),
      $storage: path.resolve(__dirname, 'src/storage'),
      $state: path.resolve(__dirname, 'src/state'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
    port: 5173,
    // Polling per file watching: necessario su drive di rete / OneDrive sync / dischi esterni
    // dove il watcher nativo di Node.js fallisce con UV_UNKNOWN errno -4094.
    // Più lento del watch nativo (~1s di latenza) ma stabile ovunque.
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
