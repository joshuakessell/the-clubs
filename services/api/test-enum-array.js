const { db } = require('./dist/db/index.js');
const { sql } = require('drizzle-orm');
async function run() {
  const res = await db.execute(sql`SELECT '{STANDARD,DOUBLE}'::rental_type[] as test_array`);
  console.log('Is Array?', Array.isArray(res.rows[0].test_array));
  console.log('Value:', res.rows[0].test_array);
  process.exit(0);
}
run();
