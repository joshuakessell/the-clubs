import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(__dirname, '../../../.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  });
}

import { db } from '../src/db';
import { products } from '../src/db/schema';
import { eq } from 'drizzle-orm';

const token = process.env.SQUARE_ACCESS_TOKEN;
const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
const baseUrl = env === 'sandbox' 
  ? 'https://connect.squareupsandbox.com' 
  : 'https://connect.squareup.com';

async function main() {
  if (!token) throw new Error('No token');
  
  const activeProducts = await db.select().from(products).where(eq(products.isActive, true));

  const batches = [];
  let currentRefId = 1;

  // Retail Category
  const categoryId = `#cat-${currentRefId++}`;
  batches.push({
    type: 'CATEGORY',
    id: categoryId,
    category_data: { name: 'Retail' }
  });

  for (const prod of activeProducts) {
    const itemObj: any = {
      type: 'ITEM',
      id: `#item-${currentRefId++}`,
      item_data: {
        name: prod.name,
        category_id: categoryId,
        variations: [
          {
            type: 'ITEM_VARIATION',
            id: `#var-${currentRefId++}`,
            item_variation_data: {
              item_id: `#item-${currentRefId - 2}`,
              name: 'Regular',
              pricing_type: 'FIXED_PRICING',
              price_money: {
                amount: prod.price, // Drizzle stores price as cents (integer)
                currency: 'USD'
              }
            }
          }
        ]
      }
    };
    batches.push(itemObj);
  }

  console.log(`Prepared ${batches.length} objects for batch upsert.`);

  // Upload to Square
  const payload = {
    idempotency_key: Math.random().toString(36).substring(7),
    batches: [
      {
        objects: batches
      }
    ]
  };

  const res = await fetch(`${baseUrl}/v2/catalog/batch-upsert`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Square-Version': '2023-12-13',
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    console.error('Batch upsert failed:', await res.text());
  } else {
    console.log('Successfully created retail items in Square!');
  }
  
  process.exit(0);
}

main().catch(console.error);
