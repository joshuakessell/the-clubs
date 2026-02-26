import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './src/db/schema',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    database: process.env.DB_NAME || 'club_operations',
    user: process.env.DB_USER || 'clubops',
    password: process.env.DB_PASSWORD || 'club-ops-dev',
    ssl: false,
  },
});
