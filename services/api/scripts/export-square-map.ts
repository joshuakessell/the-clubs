import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(__dirname, '../../../.env');
if (require('fs').existsSync(envPath)) {
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
  
  let cursor: string | undefined = undefined;
  const items: any[] = [];
  const modifiers: any[] = [];

  do {
    const res = await fetch(`${baseUrl}/v2/catalog/list` + (cursor ? `?cursor=${cursor}` : ''), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Square-Version': '2023-12-13',
      }
    });

    if (!res.ok) {
      console.error('Failed to list catalog', await res.text());
      process.exit(1);
    }

    const data: any = await res.json();
    for (const obj of (data.objects || [])) {
      if (obj.type === 'ITEM') items.push(obj);
      if (obj.type === 'MODIFIER_LIST') modifiers.push(obj);
    }
    
    cursor = data.cursor;
  } while (cursor);

  const catalogMap: Record<string, { itemId: string, variationId: string, modifiers: Record<string, string> }> = {};

  for (const item of items) {
    const name = item.item_data.name;
    const variationId = item.item_data.variations[0].id;
    const itemMods: Record<string, string> = {};
    
    const modifierListInfo = item.item_data.modifier_list_info || [];
    for (const modInfo of modifierListInfo) {
      const modParent = modifiers.find(m => m.id === modInfo.modifier_list_id);
      if (modParent) {
        const modName = modParent.modifier_list_data.name;
        // Text modifiers have 1 dummy option
        const modOpt = modParent.modifier_list_data.modifiers?.[0];
        if (modOpt) {
          itemMods[modName] = modOpt.id;
        }
      }
    }
    
    catalogMap[name] = {
      itemId: item.id,
      variationId,
      modifiers: itemMods
    };
  }

  const outPath = resolve(__dirname, '../src/services/squareCatalogMap.ts');
  const code = `// AUTO-GENERATED - DO NOT EDIT MANUALLY\n` +
               `export const SQUARE_CATALOG_MAP: Record<string, { itemId: string, variationId: string, modifiers: Record<string, string> }> = ` +
               JSON.stringify(catalogMap, null, 2) + `;\n`;

  writeFileSync(outPath, code, 'utf8');
  console.log(`Generated squareCatalogMap.ts with ${Object.keys(catalogMap).length} items`);
}

main().catch(console.error);
