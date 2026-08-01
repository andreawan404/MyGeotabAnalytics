import { defineConfig, type Plugin } from 'vite';

// Where the built add-in is hosted. MyGeotab pulls every CSS/JS/image referenced
// in the add-in HTML via its ABSOLUTE URL (it does not resolve paths relative to
// our page), so the build must bake in the full origin. Override for a different
// deployment with: ADDIN_BASE_URL=https://... npm run build
const BASE_URL = process.env.ADDIN_BASE_URL ?? 'https://my-geotab-analytics.vercel.app/';

// Every official Geotab add-in sample loads its bundle as a plain classic script.
// Vite emits `<script type="module" crossorigin>` by default, which MyGeotab's
// loader does not handle — strip both so the output matches the proven pattern.
// Paired with output.format 'iife' below, which makes the bundle valid as a
// classic script (no import/export syntax).
function geotabClassicScript(): Plugin {
  return {
    name: 'geotab-classic-script',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/ type="module"/g, '').replace(/ crossorigin/g, '');
    },
  };
}

export default defineConfig({
  base: BASE_URL,
  plugins: [geotabClassicScript()],
  build: {
    rollupOptions: {
      input: 'dashboard.html',
      output: {
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
});
