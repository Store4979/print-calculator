import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Build stamp, COMPILED INTO THE BUNDLE. Read once here, at build time, from
// the same Netlify build environment scripts/check-build-env.mjs already
// relies on (DEPLOY_ID is one of its "this is a Netlify build" signals;
// COMMIT_REF is Netlify's git metadata). Vite's `define` replaces the
// identifier with a literal, so the value lives in the emitted JS and is
// readable from a service-worker-cached bundle with no network at all.
// A missing value is passed through as null and rendered as an unmistakable
// "missing" by src/lib/buildStamp.js — never as a blank or a fake version.
const buildStamp = (() => {
  const env = process.env;
  const trim = (v) => String(v ?? "").trim();
  return {
    commit: trim(env.COMMIT_REF) || null,
    deployId: trim(env.DEPLOY_ID) || null,
    context: trim(env.CONTEXT) || null,
    builtAt: new Date().toISOString(),
  };
})();

export default defineConfig({
  define: {
    __PC_BUILD__: JSON.stringify(buildStamp),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main:   path.resolve(__dirname, 'index.html'),
        upload: path.resolve(__dirname, 'upload.html'),
      },
    },
  },
})
