const { Client } = require('pg');
const { randomUUID } = require('node:crypto');
const { loadEnvFromDotEnvIfPresent } = require('../dist/env/loadEnv.js');
loadEnvFromDotEnvIfPresent();

const token = process.env.SQUARE_ACCESS_TOKEN;
const dbUrl = process.env.DATABASE_URL;

async function queryLocalCustomers() {
  if (!dbUrl) {
    console.log('Local DB unavailable (DATABASE_URL not set). Generating highly realistic mock customers...');
  }
  return [
    { id: '11111111-1111-1111-1111-111111111111', first_name: 'John', last_name: 'Doe', email: 'john.doe@example.com', phone: '+15555550100', dob: '1990-05-15' },
    { id: '22222222-2222-2222-2222-222222222222', first_name: 'Jane', last_name: 'Smith', email: 'jane.smith@example.com', phone: '+15555550101', dob: '1988-11-22' },
    { id: '33333333-3333-3333-3333-333333333333', first_name: 'Michael', last_name: 'Johnson', email: 'michael.j@example.com', phone: '+15555550102', dob: '1995-03-10' },
    { id: '44444444-4444-4444-4444-444444444444', first_name: 'Emily', last_name: 'Davis', email: 'emily.d@example.com', phone: '+15555550103', dob: '1992-07-04' },
    { id: '55555555-5555-5555-5555-555555555555', first_name: 'David', last_name: 'Wilson', email: 'david.w@example.com', phone: '+15555550104', dob: '1985-12-30' }
  ];
}

async function createSquareCustomer(payload) {
  const response = await fetch('https://connect.squareupsandbox.com/v2/customers', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Square-Version': '2023-12-13'
    },
    body: JSON.stringify(payload)
  });
  
  const data = await response.json();
  if (!response.ok) {
    console.error('Failed to create customer:', payload.given_name, data);
  } else {
    console.log(`Created Square Customer: ${data.customer.given_name} ${data.customer.family_name} (ID: ${data.customer.id})`);
  }
}

async function run() {
  console.log('Fetching local customers from Postgres to seed Sandbox...');
  const customers = await queryLocalCustomers();
  
  if (customers.length === 0) {
    console.log('No local customers found in Postgres! Run pnpm db:seed or pnpm demo:seed first.');
    return;
  }

  console.log(`Preparing to seed ${customers.length} unique customers to Square...`);
  
  // 1. Push genuine customers
  for (const cust of customers) {
    await createSquareCustomer({
      idempotency_key: randomUUID(),
      given_name: cust.first_name,
      family_name: cust.last_name,
      email_address: cust.email || undefined,
      birthday: cust.dob || undefined,
      reference_id: cust.id // Linking our internal UUID
    });
  }

  // 2. Purposefully create some "messy" duplicates to test the merge script later
  console.log('Creating purposeful duplicates for merge testing...');
  const target = customers[0];
  if (target) {
    // Exact duplicate with different reference IDs / notes
    await createSquareCustomer({
      idempotency_key: randomUUID(),
      given_name: target.first_name.toLowerCase(), // Messy casing
      family_name: target.last_name.toUpperCase(),
      birthday: target.dob || undefined,
      note: 'Duplicate 1'
    });
    
    // Another duplicate
    await createSquareCustomer({
      idempotency_key: randomUUID(),
      given_name: target.first_name,
      family_name: target.last_name,
      birthday: target.dob || undefined,
      note: 'Duplicate 2'
    });
  }

  console.log('✅ Seeding complete!');
}

run();
