import { db } from './src/db';
import { sql } from 'drizzle-orm';

async function run() {
  try {
    const multiParam = '{00000000-0000-0000-0000-000000000000,11111111-1111-1111-1111-111111111111}';
    const res = await db.execute(sql`SELECT '22222222-2222-2222-2222-222222222222'::uuid <> ALL(${multiParam}::uuid[])`);
    console.log("Success for multi: ", res.rows);
  } catch (e) {
    console.error("Error for multi: ", e);
  }
  
  try {
     const assigned_to_customer_id = 'c1ba36ef-bd24-4f4c-8bbd-bdadb1444fb5';
     const roomRes = await db.execute<{ id: string; number: string }>(
         sql`SELECT id, number
          FROM inventory_resources
          WHERE status = 'CLEAN'
            AND assigned_to_customer_id IS NULL
            AND kind = 'room'
            AND tier::text = ${'STANDARD'}
            AND id <> ALL(${'{}'}::uuid[])
          ORDER BY number ASC
          LIMIT 1`
     );
     console.log("Room res: ", roomRes.rows);
  } catch(e) {
      console.error("Error for full query: ", e);
  }
  process.exit();
}
run();
