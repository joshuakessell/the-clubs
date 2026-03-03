import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@the-clubs/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
        },
    },
    server: {
        port: 5174,
        strictPort: true,
        proxy: {
            // Regular API calls (getApiUrl produces /api/v1/…)
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                rewrite: function (path) { return path.replace(/^\/api/, ''); },
            },
            // SSE / direct paths (API_BASE_URL is empty in dev, so paths are /v1/…)
            '/v1': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
});
