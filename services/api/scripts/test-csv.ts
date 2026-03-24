import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const csvContent = readFileSync(resolve(__dirname, '../../../square_catalog_inventory.csv'), 'utf-8');
const lines = csvContent.split('\n').map(l => l.trim()).filter(Boolean);
const headers = lines[0].split(',').map(h => h.trim());

const records = lines.slice(1).map(line => {
  const matches: string[] = [];
  let inQuotes = false;
  let currentWord = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
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

console.log(records);
