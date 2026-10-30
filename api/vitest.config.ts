import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    // Todos los archivos comparten la misma BD de pruebas: se ejecutan en serie.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
