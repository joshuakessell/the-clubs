import { query, initializeDatabase, closeDatabase } from '../src/db/index.js';
import { hashQrToken, hashPin } from '../src/auth/utils.js';

/**
 * Update existing staff names from old seed data to new seed data.
 * This script updates:
 * - "John Staff" → "John Erikson"
 * - "Jane Admin" → "Cruz Martinez"
 */
async function updateStaffNames() {
  try {
    console.log('Initializing database connection...');
    await initializeDatabase();

    console.log('Updating staff names...');

    // Update John Staff to John Erikson
    const johnResult = await query<{ id: string; name: string }>(
      `SELECT id, name FROM staff WHERE name = 'John Staff' LIMIT 1`
    );

    if (johnResult.rows.length > 0) {
      const johnId = johnResult.rows[0]!.id;
      const pinHash = await hashPin('1234');
      const qrTokenHash = hashQrToken('STAFF-001');

      await query(
        `UPDATE staff 
         SET name = 'John Erikson', role = 'STAFF', qr_token_hash = $1, pin_hash = $2
         WHERE id = $3`,
        [qrTokenHash, pinHash, johnId]
      );
      console.log('✓ Updated: John Staff → John Erikson (PIN: 1234)');
    } else {
      // Check if John Erikson already exists
      const johnErikson = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM staff WHERE name = 'John Erikson'`
      );
      if (parseInt(johnErikson.rows[0]?.count || '0', 10) === 0) {
        // Create John Erikson if doesn't exist
        const pinHash = await hashPin('1234');
        const qrTokenHash = hashQrToken('STAFF-001');
        await query(
          `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
           VALUES ('John Erikson', 'STAFF', $1, $2, true)`,
          [qrTokenHash, pinHash]
        );
        console.log('✓ Created: John Erikson (PIN: 1234)');
      } else {
        // Update PIN to 1234 if exists
        const pinHash = await hashPin('1234');
        await query(`UPDATE staff SET pin_hash = $1 WHERE name = 'John Erikson'`, [pinHash]);
        console.log('✓ Updated John Erikson PIN to 1234');
      }
    }

    // Update Jane Admin to Cruz Martinez
    const janeResult = await query<{ id: string; name: string }>(
      `SELECT id, name FROM staff WHERE name = 'Jane Admin' LIMIT 1`
    );

    if (janeResult.rows.length > 0) {
      const janeId = janeResult.rows[0]!.id;
      const pinHash = await hashPin('1234');
      const qrTokenHash = hashQrToken('STAFF-002');

      await query(
        `UPDATE staff 
         SET name = 'Cruz Martinez', role = 'ADMIN', qr_token_hash = $1, pin_hash = $2
         WHERE id = $3`,
        [qrTokenHash, pinHash, janeId]
      );
      console.log('✓ Updated: Jane Admin → Cruz Martinez (PIN: 1234)');
    } else {
      // Check if Cruz Martinez already exists
      const cruz = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM staff WHERE name = 'Cruz Martinez'`
      );
      if (parseInt(cruz.rows[0]?.count || '0', 10) === 0) {
        // Create Cruz Martinez if doesn't exist
        const pinHash = await hashPin('1234');
        const qrTokenHash = hashQrToken('STAFF-002');
        await query(
          `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
           VALUES ('Cruz Martinez', 'ADMIN', $1, $2, true)`,
          [qrTokenHash, pinHash]
        );
        console.log('✓ Created: Cruz Martinez (PIN: 1234)');
      } else {
        // Update PIN to 1234 if exists
        const pinHash = await hashPin('1234');
        await query(`UPDATE staff SET pin_hash = $1 WHERE name = 'Cruz Martinez'`, [pinHash]);
        console.log('✓ Updated Cruz Martinez PIN to 1234');
      }
    }

    console.log('\n✅ Staff names updated successfully');
  } catch (error) {
    console.error('❌ Update failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

// CLI entrypoint
updateStaffNames()
  .then(() => {
    console.log('\nUpdate completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Update failed:', error);
    process.exit(1);
  });
