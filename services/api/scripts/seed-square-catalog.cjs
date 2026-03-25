const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { loadEnvFromDotEnvIfPresent } = require('../dist/env/loadEnv.js');

loadEnvFromDotEnvIfPresent();

const squareToken = process.env.SQUARE_ACCESS_TOKEN;
const envStr = process.env.SQUARE_ENVIRONMENT || 'sandbox';

if (!squareToken) {
  console.error('Error: SQUARE_ACCESS_TOKEN is missing.');
  process.exit(1);
}

const ITEMS_TO_CREATE = [
  { name: 'One Time Membership', price: 1000 },
  { name: '6 Month Membership', price: 5000 },
  { name: 'Locker', price: 200 },
  { name: 'Gym Locker', price: 200 },
  { name: 'Room', price: 500 },
  { name: 'Double Room', price: 1000 },
  { name: 'Special Room', price: 1500 },
  { name: 'Youth Locker', price: 200 },
  { name: 'Youth Room', price: 500 },
  { name: 'Youth Double Room', price: 1000 },
  { name: 'Late Fee - 30 Min', price: 500 },
  { name: 'Late Fee - 60 Min', price: 1000 },
  { name: 'Late Fee - 90 Min', price: 1500 },
  { name: 'Renewal - 2 Hours', price: 500 },
  { name: 'Renewal - 6 Hours', price: 1500 },
  { name: 'Lost Key Fee', price: 2500 },
  { name: 'Retail Items', price: 0 }
];

async function seedCatalog() {
  console.log(`Seeding Square Catalog (${envStr})...`);
  
  const batches = [];
  
  for (const item of ITEMS_TO_CREATE) {
    const objectId = `#${item.name.replace(/\s+/g, '')}`;
    const money = item.price > 0 ? {
      amount: item.price,
      currency: 'USD'
    } : undefined;

    batches.push({
      type: 'ITEM',
      id: objectId,
      item_data: {
        name: item.name,
        variations: [
          {
            type: 'ITEM_VARIATION',
            id: `${objectId}_var`,
            item_variation_data: {
              name: 'Regular',
              pricing_type: item.price > 0 ? 'FIXED_PRICING' : 'VARIABLE_PRICING',
              price_money: money
            }
          }
        ]
      }
    });
  }

  const baseUrl = envStr === 'production' 
    ? 'https://connect.squareup.com' 
    : 'https://connect.squareupsandbox.com';

  try {
    const response = await fetch(`${baseUrl}/v2/catalog/batch-upsert`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${squareToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2023-12-13'
      },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        batches: [
          {
            objects: batches
          }
        ]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Failed to create catalog items:', errBody);
      return;
    }

    const body = await response.json();
    const catalogMap = {};
    for (const obj of (body.objects || [])) {
      if (obj.type === 'ITEM' && obj.item_data && obj.item_data.variations) {
        catalogMap[obj.item_data.name] = obj.item_data.variations[0].id;
      }
    }

    console.log('\n--- Catalog Object IDs ---');
    console.log(JSON.stringify(catalogMap, null, 2));
    console.log('--------------------------\n');
    console.log('Saved mapping to square-catalog-mapping.json');
    
    fs.writeFileSync(path.join(__dirname, '../square-catalog-mapping.json'), JSON.stringify(catalogMap, null, 2));
    
  } catch (err) {
    console.error('Network error', err);
  }
}

seedCatalog();
