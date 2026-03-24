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
  
  console.log('Fetching catalog to clear...');
  let objectsToDelete: string[] = [];
  let cursor: string | undefined = undefined;

  do {
    const res = await fetch(`${baseUrl}/v2/catalog/list?types=ITEM,CATEGORY,MODIFIER_LIST${cursor ? '&cursor=' + cursor : ''}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Square-Version': '2023-12-13',
      }
    });

    if (!res.ok) {
        console.error('Failed to list catalog:', await res.text());
        process.exit(1);
    }
    
    const data = await res.json();
    if (data.objects) {
        data.objects.forEach((obj: any) => objectsToDelete.push(obj.id));
    }
    cursor = data.cursor;
  } while (cursor);

  if (objectsToDelete.length === 0) {
      console.log('Catalog is already empty.');
      return;
  }

  console.log(`Deleting ${objectsToDelete.length} objects...`);
  const delRes = await fetch(`${baseUrl}/v2/catalog/batch-delete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2023-12-13',
      },
      body: JSON.stringify({
          object_ids: objectsToDelete
      })
  });

  if (!delRes.ok) {
      console.error('Failed to delete catalog:', await delRes.text());
  } else {
      console.log('Successfully cleared the Square Catalog!');
  }
}

main().catch(console.error);
