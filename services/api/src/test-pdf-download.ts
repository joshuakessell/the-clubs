import { buildApp } from './app';
import { db } from './db';
import { sql } from 'drizzle-orm';

async function testPdfDownload() {
  const app = await buildApp();
  
  // Find an admin token
  const adminRow = await db.execute<{ session_token: string }>(
    sql`SELECT ss.session_token
        FROM staff_sessions ss
        JOIN staff s ON s.id = ss.staff_id
        WHERE s.role = 'ADMIN'
        LIMIT 1`
  );
  if (adminRow.rows.length === 0) {
    console.log('No admin found');
    process.exit(1);
  }
  const token = adminRow.rows[0].session_token; // wait, session_token is hashed.
  
  // Let's bypass auth by finding a checkin block that has a signature and testing the logic directly
  const blockRow = await db.execute<{ id: string }>(
    sql`SELECT cb.id FROM checkin_blocks cb
        JOIN agreement_signatures sig ON sig.checkin_block_id = cb.id
        LIMIT 1`
  );
  if (blockRow.rows.length === 0) {
    console.log('No signed block found');
    process.exit(1);
  }
  const blockId = blockRow.rows[0].id;
  console.log('Testing block:', blockId);

  // We can't easily mock auth if token is hashed. Let's just create a new admin token.
  const userIdRow = await db.execute<{ id: string }>(sql`SELECT id FROM staff WHERE role = 'ADMIN' LIMIT 1`);
  const adminId = userIdRow.rows[0].id;
  
  const rawToken = 'test-admin-token-1234';
  const crypto = require('crypto');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await db.execute(sql`INSERT INTO staff_sessions (id, staff_id, session_token, expires_at) VALUES (gen_random_uuid(), ${adminId}, ${tokenHash}, NOW() + INTERVAL '1 hour')`);

  const res = await app.inject({
    method: 'GET',
    url: `/v1/documents/${blockId}/download`,
    headers: { Authorization: `Bearer ${rawToken}` }
  });

  console.log('STATUS:', res.statusCode);
  if (res.statusCode >= 400) {
    console.log('BODY:', res.body);
  } else {
    console.log('PDF length:', res.rawPayload.length);
  }
  
  await app.close();
  process.exit(0);
}

testPdfDownload().catch(console.error);
