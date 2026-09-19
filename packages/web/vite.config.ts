import preact from '@preact/preset-vite'
import { defineConfig } from 'vitest/config'
import { allowController } from './scripts/csp.ts'

/**
 * Vite + Vitest config. `BASE_PATH` lets a fork deploy under any sub-path (`/ai-resonance/`); the default `./` works
 * on any host because every URL in the app is relative. The pre-paint theme script lives in `public/boot.js`; the CSP
 * gains the report controller's hash (`scripts/csp.ts`) so Export › Preview stays interactive.
 */
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [preact(), { name: 'report-controller-csp', transformIndexHtml: allowController }],
  build: {
    target: 'es2022',
    // Lazy chunks come from dynamic imports only; no manual chunking, so the initial graph stays honest.
    chunkSizeWarningLimit: 300,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
})
