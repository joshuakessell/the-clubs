import { initializeDatabase, closeDatabase, db } from '../db/index';
import { sql } from 'drizzle-orm';
import { createSquareCustomer } from '../services/squareSyncService';
import { randomUUID } from 'node:crypto';
import { loadEnvFromDotEnvIfPresent } from '../env/loadEnv';

loadEnvFromDotEnvIfPresent();


const token = process.env.SQUARE_ACCESS_TOKEN;
const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
const baseUrl = env === 'sandbox' 
  ? 'https://connect.squareupsandbox.com' 
  : 'https://connect.squareup.com';

async function syncCustomers() {
  console.log('\nFetching Customers from Database...');
  const custResult = await db.execute<Record<string, unknown>>(
    sql`SELECT id, name, dob, square_customer_id FROM customers WHERE square_customer_id IS NULL LIMIT 100`
  );
  const customersArray = custResult.rows;

  console.log(`Found ${customersArray.length} un-synced customers. Syncing to Square...`);

  for (const c of customersArray) {
     const fullName = String(c.name || 'Unknown');
     const parts = fullName.split(' ');
     const firstName = parts[0];
     const lastName = parts.length > 1 ? parts.slice(1).join(' ') : 'Customer';
     
     console.log(` -> Syncing Customer: ${fullName}...`);
     
     const squareId = await createSquareCustomer({
       firstName,
       lastName,
       dob: c.dob ? new Date(String(c.dob)).toISOString().split('T')[0] : null,
       referenceId: String(c.id)
     });
     
     if (squareId) {
       await db.execute(sql`UPDATE customers SET square_customer_id = ${squareId} WHERE id = ${c.id}`);
     }
  }
  console.log('✅ Customer synchronization complete.');
}

async function syncStaffMembers(baseUrl: string, token: string) {
  console.log('\nFetching Staff from Database...');
  const staffResult = await db.execute<Record<string, unknown>>(
    sql`SELECT id, name, role FROM staff`
  );
  
  console.log(`Found ${staffResult.rows.length} staff members. Creating Team Members in Square Sandbox...`);
  
  for (const st of staffResult.rows) {
     const fullName = String(st.name || 'Unknown Staff');
     const parts = fullName.split(' ');
     const given_name = parts[0];
     const family_name = parts.length > 1 ? parts.slice(1).join(' ') : 'Staff';
     
     console.log(` -> Creating Team Member: ${fullName}...`);
     
     const payload = {
       idempotency_key: randomUUID(),
       team_member: {
         reference_id: String(st.id),
         status: 'ACTIVE',
         given_name,
         family_name,
         is_owner: st.role === 'ADMIN'
       }
     };
     
     try {
       const tmRes = await fetch(`${baseUrl}/v2/team-members`, {
         method: 'POST',
         headers: {
           'Square-Version': '2023-12-13',
           'Authorization': `Bearer ${token}`,
           'Content-Type': 'application/json'
         },
         body: JSON.stringify(payload)
       });
       
       if (!tmRes.ok) {
         const errText = await tmRes.text();
         console.error(`    ❌ Failed to create Team Member [${tmRes.status}]: ${errText}`);
       }
     } catch (err) {
       console.error(`    ❌ Network Exception creating Team Member:`, err);
     }
  }
  
  console.log('✅ Staff Team Member synchronization complete.');
}

async function seedSquareEntities() {
  if (!token) {
    console.error('❌ Missing SQUARE_ACCESS_TOKEN. Cannot seed Square.');
    process.exit(1);
  }

  console.log('Initializing database connection...');
  await initializeDatabase();
  
  try {
    await syncCustomers();
    await syncStaffMembers(baseUrl, token);

  } catch (err) {
    console.error('❌ SEED ERROR:', err);
  } finally {
    await closeDatabase();
  }
}

if (require.main === module) {
  (async () => {
    try {
      await seedSquareEntities();
      process.exit(0);
    } catch (err) {
      console.error('Fatal Execution Error:', err);
      process.exit(1);
    }
  })();
}
