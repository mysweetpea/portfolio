import { defineConfig } from 'astro/config';

// Static output only — no adapter needed for Workers static assets.
// The BUILD OUTPUT is deployed; this directory is never deployed directly.
export default defineConfig({
  output: 'static',
  outDir: './dist',
  // Preserve the legacy pretty-URL behaviour: Workers Assets serves /x for
  // x.html and 307s /x.html -> /x, so we keep emitting flat *.html files.
  build: { format: 'file' },
  devToolbar: { enabled: false },
});
