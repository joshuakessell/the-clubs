import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // Resolve @the-clubs/shared from TypeScript source instead of pre-compiled
            // dist/. This lets Vite process import.meta.env.VITE_API_BASE_URL directly
            // and replace it at build time (tsc compilation strips this replacement).
            '@the-clubs/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
        },
    },
    server: {
        port: 5175,
        strictPort: true,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                rewrite: function (path) { return path.replace(/^\/api/, ''); },
            },
            '/v1': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
});
