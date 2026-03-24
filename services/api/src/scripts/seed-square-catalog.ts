import { randomUUID } from 'node:crypto';
import { loadEnvFromDotEnvIfPresent } from '../env/loadEnv';

loadEnvFromDotEnvIfPresent();

// Helper macro for creating an item with variations
function buildItem(name: string, variations: { name: string; priceCents: number }[]) {
  // Unique ID for the parent item in the batch
  const itemId = `#item-${name.replaceAll(/\s+/g, '-')}`;
  
  return {
    type: 'ITEM',
    id: itemId,
    present_at_all_locations: true,
    item_data: {
      name,
      variations: variations.map((v, idx) => ({
        type: 'ITEM_VARIATION',
        id: `#var-${name.replaceAll(/\s+/g, '-')}-${idx}`,
        present_at_all_locations: true,
        item_variation_data: {
          item_id: itemId,
          name: v.name,
          pricing_type: 'FIXED_PRICING',
          price_money: {
            amount: v.priceCents,
            currency: 'USD'
          }
        }
      }))
    }
  };
}

// Use strict node-fetch or native fetch. Node 18+ has native fetch.
async function seedSquareCatalog() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  const baseUrl = env === 'sandbox' 
    ? 'https://connect.squareupsandbox.com' 
    : 'https://connect.squareup.com';

  if (!token) {
    console.error('❌ Missing SQUARE_ACCESS_TOKEN in environment. Cannot seed Square.');
    process.exit(1);
  }

  console.log(`🌱 Seeding Square Catalog in [${env}] environment...`);

  const catalogObjects = [
    // Memberships
    buildItem('One Time Membership', [{ name: 'Standard', priceCents: 1300 }]),
    buildItem('6 Month Membership', [{ name: 'Standard', priceCents: 4300 }]),
    
    // Rentals
    buildItem('Locker', [
      { name: 'Regular Locker', priceCents: 2400 },
      { name: 'Gym Locker', priceCents: 0 }
    ]),
    buildItem('Rooms', [
      { name: 'Regular Room', priceCents: 3000 },
      { name: 'Double Room', priceCents: 4000 },
      { name: 'Special Room', priceCents: 5000 }
    ]),
    
    // Youth
    buildItem('Youth', [
      { name: 'Locker', priceCents: 700 },
      { name: 'Standard Room', priceCents: 3000 },
      { name: 'Double Room', priceCents: 5000 }
    ]),
    
    // Food & Beverage
    buildItem('Drinks', [
      { name: 'Water', priceCents: 300 },
      { name: 'Gatorade', priceCents: 300 },
      { name: 'Coke', priceCents: 300 }
    ]),
    buildItem('Snacks', [
      { name: 'Protein Bar', priceCents: 200 },
      { name: 'Honey Bun', priceCents: 200 },
      { name: 'Candy Bar', priceCents: 200 }
    ]),
    
    // Retail
    buildItem('Retail', [
      { name: 'Body Wash', priceCents: 1500 },
      { name: 'Body Lotion', priceCents: 1200 },
      { name: 'Charcoal Face Mask', priceCents: 2000 },
      { name: 'Aroma Roll-On', priceCents: 1200 },
      { name: 'Exfoliating Scrub', priceCents: 1800 },
      { name: 'Shampoo', priceCents: 1400 },
      { name: 'Conditioner', priceCents: 1400 },
      { name: 'Lip Balm', priceCents: 800 },
      { name: 'Aloe Vera Gel', priceCents: 1000 },
      { name: 'Facial Toner', priceCents: 1600 }
    ]),
    
    // Fees
    buildItem('Lost Keys', [{ name: 'Replacement Fee', priceCents: 5000 }]),
    buildItem('Late Fee', [
      { name: 'Level 1 (30-59 mins)', priceCents: 1500 },
      { name: 'Level 2 (60+ mins)', priceCents: 3000 }
    ])
  ];

  const payload = {
    idempotency_key: randomUUID(),
    batches: [
      {
        objects: catalogObjects
      }
    ]
  };

  try {
    const res = await fetch(`${baseUrl}/v2/catalog/batch-upsert`, {
      method: 'POST',
      headers: {
        'Square-Version': '2023-12-13',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`❌ Square API Error [${res.status}]:`, errorText);
      process.exit(1);
    }

    await res.json();
    console.log(`✅ successfully seeded ${catalogObjects.length} categories/items into Square Sandbox!`);
  } catch (err) {
    console.error('❌ Failed to execute seed:', err);
    process.exit(1);
  }
}

// Ensure execution wraps dotenv if needed
if (require.main === module) {
  seedSquareCatalog();
}
