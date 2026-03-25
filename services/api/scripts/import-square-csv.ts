import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(__dirname, '../../../.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  });
}

const token = process.env.SQUARE_ACCESS_TOKEN;
const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
const baseUrl = env === 'sandbox' 
  ? 'https://connect.squareupsandbox.com' 
  : 'https://connect.squareup.com';

async function main() {
  if (!token) throw new Error('No token');
  
  const csvContent = readFileSync(resolve(__dirname, '../../../square_catalog_inventory.csv'), 'utf-8');
  
  // Parse CSV natively
  const lines = csvContent.split('\n').map(l => l.trim()).filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim());
  
  const records = lines.slice(1).map(line => {
    const matches: string[] = [];
    let inQuotes = false;
    let currentWord = '';
    for (const element of line) {
        const char = element;
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            matches.push(currentWord.trim());
            currentWord = '';
        } else {
            currentWord += char;
        }
    }
    matches.push(currentWord.trim());

    const obj: any = {};
    headers.forEach((h, i) => {
        obj[h] = matches[i] ?? '';
    });
    return obj;
  });

  const batches: any[] = [];
  let currentRefId = 1;

  for (const row of records) {
    const name = row['Item Name'];
    const categoryName = row['Category'];
    let priceStr = row['Default Price'];
    const detailsStr = row['Required Details (Modifiers)'];

    console.log(`Processing: ${name}`);

    // Create item
    const itemId = `#item-${currentRefId++}`;
    const categoryId = `#cat-${categoryName}`; 
    // Wait, let's just create independent items for now. Square auto-creates categories if ID is valid, or we can just skip category for the demo.
    
    // Parse price
    let amountCents = 0;
    if (priceStr.startsWith('$')) {
      amountCents = Math.round(parseFloat(priceStr.substring(1)) * 100);
    }
    const isVariable = priceStr === 'Variable';

    const itemObj: any = {
      type: 'ITEM',
      id: itemId,
      item_data: {
        name: name,
        description: row['Price Notes'],
        variations: [
          {
            type: 'ITEM_VARIATION',
            id: `#var-${currentRefId++}`,
            item_variation_data: {
              item_id: itemId,
              name: 'Regular',
              pricing_type: isVariable ? 'VARIABLE_PRICING' : 'FIXED_PRICING',
              ...(!isVariable && {
                price_money: { amount: amountCents, currency: 'USD' }
              })
            }
          }
        ],
        modifier_list_info: []
      }
    };

    // Parse text modifiers
    if (detailsStr && detailsStr !== 'None') {
      const details = detailsStr.split(';').map((d: string) => d.trim()).filter(Boolean);
      for (const detail of details) {
        // Square supports text modifiers on the POS via "Custom text" modifiers? 
        // Let's create a modifier list for it with a dummy option if text isn't supported, 
        // or let's create a modifier list with single text choice? 
        // Square actually supports `modifier_list_data.modifier_type = 'TEXT'` in some APIs?
        const modId = `#mod-${currentRefId++}`;
        batches.push({
          type: 'MODIFIER_LIST',
          id: modId,
          modifier_list_data: {
            name: detail,
            modifier_type: 'TEXT',
          }
        });
        itemObj.item_data.modifier_list_info.push({
          modifier_list_id: modId,
          min_selected_modifiers: 0,
          max_selected_modifiers: 1,
          enabled: true
        });
      }
    }

    batches.push(itemObj);
  }

  const payload = {
    idempotency_key: Math.random().toString(36).substring(7),
    batches: [{ objects: batches }]
  };

  const res = await fetch(`${baseUrl}/v2/catalog/batch-upsert`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-10-17',
    },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    console.log('Successfully created items with text modifiers in Square!');
  } else {
    console.error('Batch upsert failed:', await res.text());
  }
}

main().catch(console.error);
