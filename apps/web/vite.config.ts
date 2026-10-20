import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Development builds only (`pnpm dev`): every page polls `/` and reloads when
 * the build stamp in it changes, so the laptop and every paired tablet pick up
 * a rebuild on their own.
 */
function reloadOnRebuild(): Plugin {
  return {
    name: 'torta-reload-on-rebuild',
    apply: (_, env) => env.mode === 'development',
    transformIndexHtml() {
      const stamp = Date.now().toString();
      return [
        {
          tag: 'meta',
          attrs: { name: 'torta-build', content: stamp },
          injectTo: 'head',
        },
        {
          tag: 'script',
          children: `setInterval(async () => {
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text();
    const next = html.match(/name="torta-build" content="(\\d+)"/)?.[1];
    if (next && next !== '${stamp}') location.reload();
  } catch {}
}, 1000);`,
          injectTo: 'body',
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), reloadOnRebuild()],
  build: {
    // A watch rebuild must not delete dist first: the server would briefly have
    // no index.html to serve, and licenses.txt would disappear.
    emptyOutDir: mode !== 'development',
    sourcemap: mode === 'development',
    // React's development build is large; the warning only matters for releases.
    chunkSizeWarningLimit: mode === 'development' ? Infinity : 500,
    rollupOptions: {
      onwarn(warning, warn) {
        // flora keeps its "use client" directives in its build output. They mean
        // nothing in an SPA, so the warnings are silenced.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
    },
  },
}));
