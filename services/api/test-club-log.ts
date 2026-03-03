import Fastify from 'fastify';
import { query } from './src/db';
import { registerAdminClubLogRoutes } from './src/routes/admin/club-log';

async function main() {
  const result = await query('SELECT count(*) FROM club_events');
  console.log('club_events count:', result.rows);
}
main().catch(console.error);
