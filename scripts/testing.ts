import { query } from './services/api/src/db';
async function test() {
  const result = await query('SELECT count(*) FROM club_events');
  console.log('club_events count:', result.rows[0].count);
  const result2 = await query('SELECT * FROM club_events LIMIT 1');
  console.log('club_events sample:', result2.rows[0]);
  process.exit(0);
}
test();
