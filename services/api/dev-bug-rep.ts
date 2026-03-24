import { db } from './src/db';
import { sql } from 'drizzle-orm';
import { executeFlowCommandTransaction } from './src/services/checkin/flowCommandService';

async function run() {
  try {
    const laneRes = await db.execute<{ id: string }>(
      sql`INSERT INTO checkin_lanes (name, identifier) VALUES ('Bug Replication', 'bug-rep') RETURNING id`
    );
    const laneId = laneRes.rows[0].id;

    const custRes = await db.execute<{ id: string }>(
      sql`INSERT INTO customers (name, dob, member_type) VALUES ('Test Bug Rep', '1990-01-01', 'FULL') RETURNING id`
    );
    const customerId = custRes.rows[0].id;

    // Seed a standard room
    await db.execute(
      sql`INSERT INTO inventory_resources (number, kind, tier, status) VALUES ('123456-BUG', 'room', 'STANDARD', 'CLEAN')`
    );

    console.log("Seeded successfully, executing commands...");

    const sr = await db.execute<{ id: string }>(
      sql`INSERT INTO lane_sessions (lane_id, status, flow_step) VALUES (${laneId}, 'ACTIVE', 'RENTAL') RETURNING id`
    );
    const sessionId = sr.rows[0].id;

    await executeFlowCommandTransaction(laneId, {
      sessionId,
      commandId: 'cmd1-bug',
      actor: 'CUSTOMER',
      type: 'PROPOSE_SELECTION',
      payload: { rentalType: 'STANDARD' }
    });

    await executeFlowCommandTransaction(laneId, {
      sessionId,
      commandId: 'cmd2-bug',
      actor: 'CUSTOMER',
      type: 'CONFIRM_SELECTION'
    });

    await executeFlowCommandTransaction(laneId, {
      sessionId,
      commandId: 'cmd3-bug',
      actor: 'CUSTOMER',
      type: 'SET_STEP',
      payload: { step: 'PAYMENT' }
    });

    console.log("Executed successfully without 500 error!");

  } catch (e) {
    console.error("CAUGHT 500 ERROR: ", e);
  } finally {
    console.log("Cleaning up...");
    await db.execute(sql`DELETE FROM checkin_lanes WHERE identifier = 'bug-rep'`);
    await db.execute(sql`DELETE FROM customers WHERE name = 'Test Bug Rep'`);
    await db.execute(sql`DELETE FROM inventory_resources WHERE number = '123456-BUG'`);
    process.exit();
  }
}

run();
