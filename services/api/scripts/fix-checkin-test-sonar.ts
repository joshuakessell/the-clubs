import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const testPath = resolve(__dirname, '../../../services/api/tests/checkin.test.ts');
let content = readFileSync(testPath, 'utf-8');

// The `!` is an unnecessary assertion if `rows[0]` is already typed as `T`.
// Replace all `.rows[0]!` with `.rows[0]?.` safely for method accesses
// Wait, expect(roomAfter.rows[0]?.assigned_to_customer_id) works perfectly.
content = content.replace(/\.rows\[0\]!/g, '.rows[0]');

writeFileSync(testPath, content);
console.log('Fixed SonarQube unnecessary assertions in checkin.test.ts!');
