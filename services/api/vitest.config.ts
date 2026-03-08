import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: [
            {
                find: '@the-clubs/shared',
                replacement: path.resolve(__dirname, '../../packages/shared/src'),
            },
            {
                find: '@',
                replacement: path.resolve(__dirname, './src'),
            },
        ],
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
        pool: 'forks',
        maxWorkers: 1,
        isolate: true,
        teardownTimeout: 10000,
        forceExit: true,
        reporters: process.env.CI ? ['default', 'hanging-process'] : ['default'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary'],
            include: ['src/**'],
            exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
        },
    },
});
