import { randomUUID } from 'crypto';
import { db } from './src/db';
import { sql } from 'drizzle-orm';

(async () => {
  try {
    const laneRes = await db.execute<{ device_id: string }>(sql`SELECT device_id FROM devices LIMIT 1`);
    const laneId = laneRes.rows[0].device_id;
    
    // Create random customer
    const custRes = await db.execute<{ id: string }>(sql`INSERT INTO customers (name, dob, created_at, updated_at) VALUES ('Fake Bob', '1990-01-01', NOW(), NOW()) RETURNING id`);
    const custId = custRes.rows[0].id;

    // Create a new session
    const sessionRes = await db.execute<{ id: string }>(sql`
      INSERT INTO lane_sessions (lane_id, status, staff_id, customer_id, customer_display_name, checkin_mode, flow_step, flow_version)
      VALUES (${laneId}, 'ACTIVE', '3a32ea07-f316-41e8-a111-667793d56a29', ${custId}, 'Test', 'CHECKIN', 'RENTAL', 0)
      RETURNING id
    `);
    const sessionId = sessionRes.rows[0].id;

    const auth = {
      Authorization: `Bearer dev-kiosk-token`
    };

    console.log('Propose Standard Room...', laneId, sessionId);
    const r1 = await fetch(`http://localhost:3001/api/v1/checkin/lane/${laneId}/flow-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        sessionId, commandId: randomUUID(), actor: 'EMPLOYEE', type: 'PROPOSE_SELECTION', payload: { rentalType: 'STANDARD' }
      })
    });
    console.log(await r1.text());

    console.log('Confirm Standard Room...');
    const r2 = await fetch(`http://localhost:3001/api/v1/checkin/lane/${laneId}/flow-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        sessionId, commandId: randomUUID(), actor: 'EMPLOYEE', type: 'CONFIRM_SELECTION'
      })
    });
    console.log(await r2.text());

    console.log('Set Step PAYMENT (Trigger Error)...');
    const r3 = await fetch(`http://localhost:3001/api/v1/checkin/lane/${laneId}/flow-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        sessionId, commandId: randomUUID(), actor: 'EMPLOYEE', type: 'SET_STEP', payload: { step: 'PAYMENT' }
      })
    });
    console.log('STATUS:', r3.status, 'BODY:', await r3.text());

  } catch (err) {
    console.error(err);
  }
  process.exit();
})();
