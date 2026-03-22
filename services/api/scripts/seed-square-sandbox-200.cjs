const { loadEnvFromDotEnvIfPresent } = require('../dist/env/loadEnv.js');
loadEnvFromDotEnvIfPresent();

// We'll use dynamic import since @faker-js/faker might be ESM in newer versions
async function run() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    console.error('Missing SQUARE_ACCESS_TOKEN in .env');
    return;
  }

  // Load faker dynamically
  const { faker } = await import('@faker-js/faker');
  faker.seed(12345); // Reproducible randomness

  console.log('Generating exactly 200 customer payloads...');
  const customers = [];
  const TOTAL = 200;
  
  // Requirement: 20% duplicates (40 out of 200 entries) => We need 20 originals to duplicate, making 40 duplicates total, or 40 duplicates OF existing things (meaning 40 entries are redundant).
  // requirement: 5% same name different dob (10 out of 200 entries).
  
  const exactDuplicatesCount = 40; 
  const sameNameDiffDobCount = 10;
  const uniqueCount = TOTAL - exactDuplicatesCount; // 160 base unique people
  
  const basePeople = [];

  for (let i = 0; i < uniqueCount; i++) {
    const firstName = faker.person.firstName('male');
    const lastName = faker.person.lastName();
    const dob = faker.date.birthdate({ min: 18, max: 65, mode: 'age' }).toISOString().split('T')[0];
    
    // 50% chance to have a reference ID (10-11 digits)
    const hasRefId = faker.number.float() < 0.5;
    let refId;
    if (hasRefId) {
      refId = faker.string.numeric({ length: { min: 10, max: 11 } });
    }

    basePeople.push({
      firstName,
      lastName,
      dob,
      refId,
      email: faker.internet.email({ firstName, lastName })
    });
  }

  // Add 160 base unique people
  for (const person of basePeople) {
    customers.push({
      idempotency_key: faker.string.uuid(),
      given_name: person.firstName,
      family_name: person.lastName,
      birthday: person.dob,
      reference_id: person.refId,
      email_address: person.email,
    });
  }

  // Now generate 40 duplicates from the first 40 people
  for (let i = 0; i < exactDuplicatesCount; i++) {
    const original = basePeople[i];
    // Messy duplication: lower case, missing email, or no ref ID
    customers.push({
      idempotency_key: faker.string.uuid(),
      given_name: original.firstName.toLowerCase(),
      family_name: original.lastName.toUpperCase(),
      birthday: original.dob,
      // Leaving out email to simulate messy incomplete data
      note: 'Potential Duplicate Entry'
    });
  }
  
  // Now modify the last 10 entries to be "false positives" (same name, different DOB)
  // We'll just overwrite their names to match the first 10 people, but keep their original DOBs from basePeople.
  // Wait, the prompt says "about 5% will have the same first and last name but different birthdays".
  // So out of our 200 items, let's take 10 of the base uniqueness, and make their names identical to 10 OTHER base unique people, but keep their DOB different.
  for (let i = 0; i < sameNameDiffDobCount; i++) {
    // customers array length is 200 right now (160 + 40)
    // We modify entries at index 100 to 109 to mirror names of 0 to 9
    customers[100 + i].given_name = customers[i].given_name;
    customers[100 + i].family_name = customers[i].family_name;
    // DOB is already different because it was generated uniquely.
  }

  console.log(`Generated ${customers.length} payloads. Simulating network requests to Square Sandbox via POST /v2/customers...`);

  const chunkSize = 100; // max 100 per bulk request
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < customers.length; i += chunkSize) {
    const chunk = customers.slice(i, i + chunkSize);
    console.log(`Processing bulk batch ${i / chunkSize + 1} / ${Math.ceil(customers.length / chunkSize)}...`);
    
    // Construct bulk payload mapping
    const customersMap = {};
    for (const c of chunk) {
      const { idempotency_key, ...customerData } = c;
      customersMap[idempotency_key] = customerData;
    }

    try {
      const response = await fetch('https://connect.squareupsandbox.com/v2/customers/bulk-create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Square-Version': '2023-12-13'
        },
        body: JSON.stringify({ customers: customersMap })
      });
      
      if (response.ok) {
        const body = await response.json();
        const createdCount = Object.keys(body.responses || {}).length;
        successCount += createdCount;
      } else {
        const errBody = await response.text();
        console.error(`Bulk batch failed:`, errBody);
        failCount += chunk.length;
      }
    } catch (err) {
      console.error('Network error during bulk create', err.message);
      failCount += chunk.length;
    }
  }

  console.log(`\nSeed complete! Created ${successCount} customers, ${failCount} failures.`);
}

run().catch(console.error);
