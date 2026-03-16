import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/schema.ts',
  out: './src/db/schema',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: Number.parseInt(process.env.DB_PORT || '5433', 10),
    database: process.env.DB_NAME || 'club_operations',
    user: process.env.DB_USER || 'clubops',
    password: process.env.DB_PASSWORD || 'club-ops-dev',
    ssl: false,
  },
});
