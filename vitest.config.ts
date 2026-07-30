import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        // Only the scoring engine is under test today. Widen this glob when
        // club-identity / lineup tests land — see CLAUDE.md.
        include: ['src/**/__tests__/**/*.test.ts'],
        environment: 'node',
    },
});
