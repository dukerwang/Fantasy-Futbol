import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        // Covers src/lib/**, and the API route handlers, whose __tests__
        // directories sit beside the route they exercise under src/app/api.
        include: ['src/**/__tests__/**/*.test.ts'],
        environment: 'node',
    },
});
