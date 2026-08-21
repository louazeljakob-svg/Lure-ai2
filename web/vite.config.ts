import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Echappe tout caractere non-ASCII : indispensable pour le build en fichier
  // unique, dont le contenu est integre sans balise <meta charset>.
  esbuild: { charset: 'ascii' },
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
