import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve('./examples'),
  server: { port: 8080, open: '/' },
  resolve: {
    alias: {
      '@infinite-canvas-tutorial/ecs': path.resolve(
        __dirname,
        '../ecs/src/index.ts',
      ),
      '@infinite-canvas-tutorial/webcomponents': path.resolve(
        __dirname,
        '../webcomponents/src/index.ts',
      ),
    },
  },
});
