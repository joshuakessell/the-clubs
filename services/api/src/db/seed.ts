import { query, initializeDatabase, closeDatabase } from './index';
import { RoomStatus, RoomType, AGREEMENT_LEGAL_BODY_HTML_BY_LANG } from '@the-clubs/shared';
import { LOCKER_NUMBERS, ROOMS } from '@the-clubs/shared';
import { hashQrToken, hashPin } from '../auth/utils';
import { loadEnvFromDotEnvIfPresent } from '../env/loadEnv';

loadEnvFromDotEnvIfPresent();

interface RoomSeed {
  number: string;
  type: RoomType;
  floor: number;
  tagCode: string;
}

interface LockerSeed {
  number: string; // 3-digit "001".."108"
  tagCode: string;
}

/**
 * Seed data for development and testing.
 *
 * IMPORTANT (facility inventory contract):
 * - Lockers: 001..108
 * - Rooms: existing rooms only (nominal 200..262 minus non-existent odd 247..261)
 *
 * This seed enforces inventory presence and removes any invalid legacy rooms/lockers.
 */
const seedRooms: RoomSeed[] = ROOMS.map((r: { number: number; tier: string }) => {
  const type: RoomType =
    r.tier === 'DOUBLE'
      ? RoomType.DOUBLE
      : r.tier === 'SPECIAL'
        ? RoomType.SPECIAL
        : RoomType.STANDARD;
  return {
    number: String(r.number),
    type,
    floor: Math.floor(r.number / 100),
    tagCode: `ROOM-${r.number}`,
  };
});

const seedLockers: LockerSeed[] = LOCKER_NUMBERS.map((n: string) => ({
  number: n,
  tagCode: `LOCKER-${n}`,
}));

async function seed() {
  try {
    console.log('Initializing database connection...');
    await initializeDatabase();

    console.log('Starting seed process...');

    // Enforce facility inventory contract (delete any invalid legacy rooms)
    const desiredRoomNumbers = seedRooms.map((r) => r.number);
    const deletedRooms = await query<{ count: string }>(
      `WITH del AS (
         DELETE FROM rooms
         WHERE NOT (number = ANY($1::text[]))
         RETURNING 1
       )
       SELECT COUNT(*)::text as count FROM del`,
      [desiredRoomNumbers]
    );
    if (parseInt(deletedRooms.rows[0]?.count || '0', 10) > 0) {
      console.log(
        `🧹 Removed ${deletedRooms.rows[0]!.count} invalid legacy room(s) from inventory`
      );
    }

    for (const roomSeed of seedRooms) {
      const roomResult = await query<{ id: string }>(
        `INSERT INTO rooms (number, type, status, floor, last_status_change)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (number) DO UPDATE
           SET type = EXCLUDED.type,
               floor = EXCLUDED.floor,
               updated_at = NOW()
         RETURNING id`,
        [roomSeed.number, roomSeed.type, RoomStatus.CLEAN, roomSeed.floor]
      );

      const roomId = roomResult.rows[0]!.id;

      await query(
        `INSERT INTO key_tags (room_id, tag_type, tag_code, is_active)
         VALUES ($1, 'QR', $2, true)
         ON CONFLICT (tag_code) DO UPDATE
           SET room_id = EXCLUDED.room_id,
               locker_id = NULL,
               is_active = true,
               updated_at = NOW()`,
        [roomId, roomSeed.tagCode]
      );
    }

    console.log(`\n✅ Rooms inventory ensured (${seedRooms.length} rooms)`);

    // Enforce facility inventory contract (delete any invalid legacy lockers)
    const desiredLockerNumbers = seedLockers.map((l) => l.number);
    const deletedLockers = await query<{ count: string }>(
      `WITH del AS (
         DELETE FROM lockers
         WHERE NOT (number = ANY($1::text[]))
         RETURNING 1
       )
       SELECT COUNT(*)::text as count FROM del`,
      [desiredLockerNumbers]
    );
    if (parseInt(deletedLockers.rows[0]?.count || '0', 10) > 0) {
      console.log(
        `🧹 Removed ${deletedLockers.rows[0]!.count} invalid legacy locker(s) from inventory`
      );
    }

    for (const lockerSeed of seedLockers) {
      const lockerResult = await query<{ id: string }>(
        `INSERT INTO lockers (number, status)
         VALUES ($1, $2)
         ON CONFLICT (number) DO UPDATE
           SET updated_at = NOW()
         RETURNING id`,
        [lockerSeed.number, RoomStatus.CLEAN]
      );

      const lockerId = lockerResult.rows[0]!.id;

      await query(
        `INSERT INTO key_tags (locker_id, tag_type, tag_code, is_active)
         VALUES ($1, 'QR', $2, true)
         ON CONFLICT (tag_code) DO UPDATE
           SET locker_id = EXCLUDED.locker_id,
               room_id = NULL,
               is_active = true,
               updated_at = NOW()`,
        [lockerId, lockerSeed.tagCode]
      );
    }

    console.log(`\n✅ Lockers inventory ensured (${seedLockers.length} lockers, 001–108)`);

    console.log('\nScan tokens for testing (sample):');
    seedRooms.slice(0, 5).forEach((room) => {
      console.log(`  - ${room.tagCode} → Room ${room.number}`);
    });
    seedLockers.slice(0, 5).forEach((locker) => {
      console.log(`  - ${locker.tagCode} → Locker ${locker.number}`);
    });

    // Seed staff users
    console.log('\nSeeding staff users...');

    const staffUsers = [
      // ── Full-time employees (6) ─────────────────────────────────
      { name: 'John Erikson',      role: 'STAFF', qrToken: 'STAFF-001', pin: '111111' },
      { name: 'Marcus Rivera',     role: 'STAFF', qrToken: 'STAFF-002', pin: '222222' },
      { name: 'Tyler Brooks',      role: 'STAFF', qrToken: 'STAFF-003', pin: '333333' },
      { name: 'Ryan Mitchell',     role: 'STAFF', qrToken: 'STAFF-004', pin: '444444' },
      { name: 'Derek Nguyen',      role: 'STAFF', qrToken: 'STAFF-005', pin: '555555' },
      { name: 'Chris Patterson',   role: 'STAFF', qrToken: 'STAFF-006', pin: '666666' },
      // ── Part-time employees (4) ─────────────────────────────────
      { name: 'Jason Morales',     role: 'STAFF', qrToken: 'STAFF-007', pin: '777777' },
      { name: 'Brandon Reyes',     role: 'STAFF', qrToken: 'STAFF-008', pin: '888888' },
      { name: 'Kyle Foster',       role: 'STAFF', qrToken: 'STAFF-009', pin: '999999' },
      { name: 'Sean Caldwell',     role: 'STAFF', qrToken: 'STAFF-010', pin: '101010' },
      // ── Management ──────────────────────────────────────────────
      { name: 'Manager Club',      role: 'ADMIN', qrToken: 'STAFF-011', pin: '123456' },
      { name: 'Manager Dallas',    role: 'ADMIN', qrToken: 'STAFF-012', pin: '654321' },
    ];

    // Check if staff already exist
    const existingStaff = await query<{ count: string }>('SELECT COUNT(*) as count FROM staff');

    if (parseInt(existingStaff.rows[0]?.count || '0', 10) > 0) {
      console.log('⚠️  Staff users already exist. Updating existing staff to match seed data...');

      // Update existing staff if they match old names or create new ones
      for (const staff of staffUsers) {
        const qrTokenHash = hashQrToken(staff.qrToken);
        const pinHash = await hashPin(staff.pin);

        // Check if staff with this name or matching old names exists
        const existing = await query<{ id: string; name: string }>(
          `SELECT id, name FROM staff 
           WHERE name = $1 
           OR (name = 'John Staff' AND $1 = 'John Erikson')
           OR (name = 'Jane Admin' AND $1 = 'Cruz Martinez')
           LIMIT 1`,
          [staff.name]
        );

        if (existing.rows.length > 0) {
          // Update existing staff
          await query(
            `UPDATE staff 
             SET name = $1, role = $2, qr_token_hash = $3, pin_hash = $4, active = true
             WHERE id = $5`,
            [staff.name, staff.role, qrTokenHash, pinHash, existing.rows[0]!.id]
          );
          console.log(`✓ Updated staff: ${existing.rows[0]!.name} → ${staff.name} (${staff.role})`);
        } else {
          // Create new staff if doesn't exist
          await query(
            `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
             VALUES ($1, $2, $3, $4, true)`,
            [staff.name, staff.role, qrTokenHash, pinHash]
          );
          console.log(`✓ Seeded staff: ${staff.name} (${staff.role})`);
        }
      }

      console.log('\n✅ Staff users updated successfully');
    } else {
      // No existing staff, create new ones
      for (const staff of staffUsers) {
        const qrTokenHash = hashQrToken(staff.qrToken);
        const pinHash = await hashPin(staff.pin);

        await query(
          `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
           VALUES ($1, $2, $3, $4, true)`,
          [staff.name, staff.role, qrTokenHash, pinHash]
        );

        console.log(`✓ Seeded staff: ${staff.name} (${staff.role})`);
      }

      console.log('\n✅ Staff users seeded successfully');
    }

    console.log('\nStaff login credentials for testing:');
    staffUsers.forEach((staff) => {
      console.log(`  - ${staff.name} (${staff.role}):`);
      console.log(`    QR Token: ${staff.qrToken}`);
      console.log(`    PIN: ${staff.pin}`);
    });

    // Seed devices for register use
    console.log('\nSeeding devices...');

    const seedDevices = [
      { deviceId: 'register-1', displayName: 'Register 1' },
      { deviceId: 'register-2', displayName: 'Register 2' },
      { deviceId: 'register-3', displayName: 'Register 3' },
    ];

    for (const device of seedDevices) {
      const existing = await query<{ count: string }>(
        'SELECT COUNT(*) as count FROM devices WHERE device_id = $1',
        [device.deviceId]
      );

      if (parseInt(existing.rows[0]?.count || '0', 10) === 0) {
        await query(
          `INSERT INTO devices (device_id, display_name, enabled)
           VALUES ($1, $2, true)`,
          [device.deviceId, device.displayName]
        );
        console.log(`✓ Seeded device: ${device.displayName} (${device.deviceId})`);
      } else {
        // Update existing device to ensure it's enabled
        await query(`UPDATE devices SET enabled = true, display_name = $1 WHERE device_id = $2`, [
          device.displayName,
          device.deviceId,
        ]);
        console.log(`✓ Updated device: ${device.displayName} (${device.deviceId})`);
      }
    }

    console.log('✅ Devices seeded successfully');

    // Seed active agreement
    console.log('\nSeeding active agreement...');

    const existingAgreement = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM agreements WHERE active = true'
    );

    const agreementBodyText = AGREEMENT_LEGAL_BODY_HTML_BY_LANG.EN;

    if (parseInt(existingAgreement.rows[0]?.count || '0', 10) > 0) {
      // Update existing active agreement if body_text is empty
      const activeAgreement = await query<{ body_text: string }>(
        'SELECT body_text FROM agreements WHERE active = true LIMIT 1'
      );
      if (
        activeAgreement.rows.length > 0 &&
        (!activeAgreement.rows[0]?.body_text || activeAgreement.rows[0].body_text.trim() === '')
      ) {
        await query(`UPDATE agreements SET body_text = $1 WHERE active = true`, [
          agreementBodyText,
        ]);
        console.log('✓ Updated active agreement with real content');
      } else {
        console.log('⚠️  Active agreement already exists with content. Skipping agreement seed.');
      }
    } else {
      await query(
        `INSERT INTO agreements (version, title, body_text, active)
         VALUES ($1, $2, $3, true)`,
        ['demo-v1', 'Club Dallas Entry & Liability Waiver (Demo)', agreementBodyText]
      );
      console.log('✓ Seeded active agreement: demo-v1');
      console.log('✅ Agreement seeded successfully');
    }
    // Seed retail products
    console.log('\nSeeding retail products...');

    const retailProducts = [
      { sku: 'body-wash',     name: 'Body Wash',          price: 15, sortOrder: 1,  imageUrl: '/images/products/body-wash.png' },
      { sku: 'body-lotion',   name: 'Body Lotion',         price: 12, sortOrder: 2,  imageUrl: '/images/products/body-lotion.png' },
      { sku: 'charcoal-mask', name: 'Charcoal Face Mask',  price: 20, sortOrder: 3,  imageUrl: '/images/products/charcoal-mask.png' },
      { sku: 'aroma-roll-on', name: 'Aroma Roll-On',       price: 12, sortOrder: 4,  imageUrl: '/images/products/aroma-roll-on.png' },
      { sku: 'body-scrub',    name: 'Exfoliating Scrub',   price: 18, sortOrder: 5,  imageUrl: '/images/products/body-scrub.png' },
      { sku: 'shampoo',       name: 'Shampoo',             price: 14, sortOrder: 6,  imageUrl: '/images/products/shampoo.png' },
      { sku: 'conditioner',   name: 'Conditioner',         price: 14, sortOrder: 7,  imageUrl: '/images/products/conditioner.png' },
      { sku: 'lip-balm',      name: 'Lip Balm',            price:  8, sortOrder: 8,  imageUrl: '/images/products/lip-balm.png' },
      { sku: 'aloe-gel',      name: 'Aloe Vera Gel',       price: 10, sortOrder: 9,  imageUrl: '/images/products/aloe-gel.png' },
      { sku: 'facial-toner',  name: 'Facial Toner',        price: 16, sortOrder: 10, imageUrl: '/images/products/facial-toner.png' },
    ];

    for (const product of retailProducts) {
      await query(
        `INSERT INTO products (sku, name, price, category, sort_order, image_url, is_active)
         VALUES ($1, $2, $3, 'RETAIL', $4, $5, true)
         ON CONFLICT (sku) DO UPDATE SET
           name       = EXCLUDED.name,
           price      = EXCLUDED.price,
           sort_order = EXCLUDED.sort_order,
           image_url  = EXCLUDED.image_url,
           is_active  = true,
           updated_at = NOW()`,
        [product.sku, product.name, product.price, product.sortOrder, product.imageUrl]
      );
    }
    console.log(`✅ Retail products seeded (${retailProducts.length} items)`);

  } catch (error) {

    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

// CLI entrypoint - run seed when executed directly
seed()
  .then(() => {
    console.log('\nSeed completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });

export { seed };
