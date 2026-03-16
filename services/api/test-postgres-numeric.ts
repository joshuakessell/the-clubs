import { db } from './src/db/index.js';
import { sql } from 'drizzle-orm';
import { customers } from './src/db/schema/schema.js';

async function test() {
  console.log('Testing past due balance update...');
  try {
    const cust = await db.select().from(customers).limit(1);
    if (cust.length === 0) {
      console.log('No customers found');
      return;
    }
    const id = cust[0].id;
    console.log('Customer:', id, 'Current balance:', cust[0].pastDueBalance);
    
    // Test the exact SQL used in checkoutService
    const feeAmount = 15;
    await db.execute(sql`UPDATE customers SET past_due_balance = past_due_balance + ${feeAmount}, updated_at = NOW() WHERE id = ${id}`);
    
    const custAfter = await db.select().from(customers).where(sql`id = ${id}`);
    console.log('After update:', custAfter[0].pastDueBalance);
    
    // Reset
    await db.execute(sql`UPDATE customers SET past_due_balance = ${cust[0].pastDueBalance}, updated_at = NOW() WHERE id = ${id}`);
    console.log('Successfully reverted');
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}

test();
