"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seed = seed;
const index_1 = require("./index");
const drizzle_orm_1 = require("drizzle-orm");
const shared_1 = require("@the-clubs/shared");
const utils_1 = require("../auth/utils");
const loadEnv_1 = require("../env/loadEnv");
(0, loadEnv_1.loadEnvFromDotEnvIfPresent)();
// Fallback defaults for local dev (matching docker-compose.yml: 5433->5432)
if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_NAME = 'club_operations';
    process.env.DB_USER = 'clubops';
    process.env.DB_PASSWORD = 'club-ops-dev';
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
const seedRooms = shared_1.ROOMS.map((r) => {
    const type = r.tier === 'DOUBLE'
        ? shared_1.RoomType.DOUBLE
        : r.tier === 'SPECIAL'
            ? shared_1.RoomType.SPECIAL
            : shared_1.RoomType.STANDARD;
    return {
        number: String(r.number),
        type,
        floor: Math.floor(r.number / 100),
        tagCode: `ROOM-${r.number}`,
    };
});
const seedLockers = shared_1.LOCKER_NUMBERS.map((n) => ({
    number: n,
    tagCode: `LOCKER-${n}`,
}));
async function seed() {
    try {
        console.log('Initializing database connection...');
        await (0, index_1.initializeDatabase)();
        console.log('Starting seed process...');
        // Enforce facility inventory contract (delete any invalid legacy rooms)
        const desiredRoomNumbers = seedRooms.map((r) => r.number);
        const roomArrayLiteral = `ARRAY[${desiredRoomNumbers.map((n) => `'${n}'`).join(',')}]::text[]`;
        const deletedRooms = await index_1.db.execute((0, drizzle_orm_1.sql) `WITH del AS (
         DELETE FROM inventory_resources
         WHERE kind = 'room'
           AND NOT (number = ANY(${drizzle_orm_1.sql.raw(roomArrayLiteral)}))
         RETURNING 1
       )
       SELECT COUNT(*)::text as count FROM del`);
        const deletedRoomCount = Number.parseInt(deletedRooms.rows[0]?.count || '0', 10);
        if (deletedRoomCount > 0) {
            console.log(`🧹 Removed ${deletedRoomCount} invalid legacy room(s) from inventory`);
        }
        for (const roomSeed of seedRooms) {
            const roomResult = await index_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO inventory_resources (number, kind, tier, status, floor, last_status_change)
         VALUES (${roomSeed.number}, 'room', ${roomSeed.type}, ${shared_1.RoomStatus.CLEAN}, ${roomSeed.floor}, NOW())
         ON CONFLICT (number) DO UPDATE
           SET tier = EXCLUDED.tier,
               floor = EXCLUDED.floor,
               updated_at = NOW()
         RETURNING id`);
            const roomId = roomResult.rows[0]?.id ?? '';
            await index_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO key_tags (resource_id, tag_type, tag_code, is_active)
         VALUES (${roomId}, 'QR', ${roomSeed.tagCode}, true)
         ON CONFLICT (tag_code) DO UPDATE
           SET resource_id = EXCLUDED.resource_id,
               is_active = true,
               updated_at = NOW()`);
        }
        console.log(`\n✅ Rooms inventory ensured (${seedRooms.length} rooms)`);
        // Enforce facility inventory contract (delete any invalid legacy lockers)
        const desiredLockerNumbers = seedLockers.map((l) => l.number);
        const lockerArrayLiteral = `ARRAY[${desiredLockerNumbers.map((n) => `'${n}'`).join(',')}]::text[]`;
        const deletedLockers = await index_1.db.execute((0, drizzle_orm_1.sql) `WITH del AS (
         DELETE FROM inventory_resources
         WHERE kind = 'locker'
           AND NOT (number = ANY(${drizzle_orm_1.sql.raw(lockerArrayLiteral)}))
         RETURNING 1
       )
       SELECT COUNT(*)::text as count FROM del`);
        const deletedLockerCount = Number.parseInt(deletedLockers.rows[0]?.count || '0', 10);
        if (deletedLockerCount > 0) {
            console.log(`🧹 Removed ${deletedLockerCount} invalid legacy locker(s) from inventory`);
        }
        for (const lockerSeed of seedLockers) {
            const lockerResult = await index_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO inventory_resources (number, kind, status)
         VALUES (${lockerSeed.number}, 'locker', ${shared_1.RoomStatus.CLEAN})
         ON CONFLICT (number) DO UPDATE
           SET updated_at = NOW()
         RETURNING id`);
            const lockerId = lockerResult.rows[0]?.id ?? '';
            await index_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO key_tags (resource_id, tag_type, tag_code, is_active)
         VALUES (${lockerId}, 'QR', ${lockerSeed.tagCode}, true)
         ON CONFLICT (tag_code) DO UPDATE
           SET resource_id = EXCLUDED.resource_id,
               is_active = true,
               updated_at = NOW()`);
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
            { name: 'John Erikson', role: 'STAFF', qrToken: 'STAFF-001', pin: '111111' },
            { name: 'Marcus Rivera', role: 'STAFF', qrToken: 'STAFF-002', pin: '222222' },
            { name: 'Tyler Brooks', role: 'STAFF', qrToken: 'STAFF-003', pin: '333333' },
            { name: 'Ryan Mitchell', role: 'STAFF', qrToken: 'STAFF-004', pin: '444444' },
            { name: 'Derek Nguyen', role: 'STAFF', qrToken: 'STAFF-005', pin: '555555' },
            { name: 'Chris Patterson', role: 'STAFF', qrToken: 'STAFF-006', pin: '666666' },
            // ── Part-time employees (4) ─────────────────────────────────
            { name: 'Jason Morales', role: 'STAFF', qrToken: 'STAFF-007', pin: '777777' },
            { name: 'Brandon Reyes', role: 'STAFF', qrToken: 'STAFF-008', pin: '888888' },
            { name: 'Kyle Foster', role: 'STAFF', qrToken: 'STAFF-009', pin: '999999' },
            { name: 'Sean Caldwell', role: 'STAFF', qrToken: 'STAFF-010', pin: '101010' },
            // ── Management ──────────────────────────────────────────────
            { name: 'Manager Club', role: 'ADMIN', qrToken: 'STAFF-011', pin: '123456' },
            { name: 'Manager Dallas', role: 'ADMIN', qrToken: 'STAFF-012', pin: '654321' },
        ];
        // Check if staff already exist
        const existingStaff = await index_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count FROM staff`);
        if (Number.parseInt(existingStaff.rows[0]?.count || '0', 10) > 0) {
            console.log('⚠️  Staff users already exist. Updating existing staff to match seed data...');
            // Update existing staff if they match old names or create new ones
            for (const staff of staffUsers) {
                const qrTokenHash = (0, utils_1.hashQrToken)(staff.qrToken);
                const pinHash = await (0, utils_1.hashPin)(staff.pin);
                // Check if staff with this name or matching old names exists
                const existing = await index_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name FROM staff 
           WHERE name = ${staff.name} 
           OR (name = 'John Staff' AND ${staff.name} = 'John Erikson')
           OR (name = 'Jane Admin' AND ${staff.name} = 'Cruz Martinez')
           LIMIT 1`);
                if (existing.rows.length > 0) {
                    const existingId = existing.rows[0]?.id ?? '';
                    const existingName = existing.rows[0]?.name ?? 'Unknown';
                    // Update existing staff
                    await index_1.db.execute((0, drizzle_orm_1.sql) `UPDATE staff 
             SET name = ${staff.name}, role = ${staff.role}, qr_token_hash = ${qrTokenHash}, pin_hash = ${pinHash}, active = true
             WHERE id = ${existingId}`);
                    console.log(`✓ Updated staff: ${existingName} → ${staff.name} (${staff.role})`);
                }
                else {
                    // Create new staff if doesn't exist
                    await index_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
             VALUES (${staff.name}, ${staff.role}, ${qrTokenHash}, ${pinHash}, true)`);
                    console.log(`✓ Seeded staff: ${staff.name} (${staff.role})`);
                }
            }
            console.log('\n✅ Staff users updated successfully');
        }
        else {
            // No existing staff, create new ones
            for (const staff of staffUsers) {
                const qrTokenHash = (0, utils_1.hashQrToken)(staff.qrToken);
                const pinHash = await (0, utils_1.hashPin)(staff.pin);
                await index_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
           VALUES (${staff.name}, ${staff.role}, ${qrTokenHash}, ${pinHash}, true)`);
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
            const existing = await index_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count FROM devices WHERE device_id = ${device.deviceId}`);
            if (Number.parseInt(existing.rows[0]?.count || '0', 10) === 0) {
                await index_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO devices (device_id, display_name, enabled)
           VALUES (${device.deviceId}, ${device.displayName}, true)`);
                console.log(`✓ Seeded device: ${device.displayName} (${device.deviceId})`);
            }
            else {
                // Update existing device to ensure it's enabled
                await index_1.db.execute((0, drizzle_orm_1.sql) `UPDATE devices SET enabled = true, display_name = ${device.displayName} WHERE device_id = ${device.deviceId}`);
                console.log(`✓ Updated device: ${device.displayName} (${device.deviceId})`);
            }
        }
        console.log('✅ Devices seeded successfully');
        // Seed active agreement
        console.log('\nSeeding active agreement...');
        const existingAgreement = await index_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count FROM agreements WHERE active = true`);
        const agreementBodyText = shared_1.AGREEMENT_LEGAL_BODY_HTML_BY_LANG.EN;
        if (Number.parseInt(existingAgreement.rows[0]?.count || '0', 10) > 0) {
            // Update existing active agreement if body_text is empty
            const activeAgreement = await index_1.db.execute((0, drizzle_orm_1.sql) `SELECT body_text FROM agreements WHERE active = true LIMIT 1`);
            const bodyText = activeAgreement.rows[0]?.body_text;
            if (activeAgreement.rows.length > 0 &&
                (!bodyText || bodyText.trim() === '')) {
                await index_1.db.execute((0, drizzle_orm_1.sql) `UPDATE agreements SET body_text = ${agreementBodyText} WHERE active = true`);
                console.log('✓ Updated active agreement with real content');
            }
            else {
                console.log('⚠️  Active agreement already exists with content. Skipping agreement seed.');
            }
        }
        else {
            await index_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO agreements (version, title, body_text, active)
         VALUES (${'demo-v1'}, ${'Club Dallas Entry & Liability Waiver (Demo)'}, ${agreementBodyText}, true)`);
            console.log('✓ Seeded active agreement: demo-v1');
            console.log('✅ Agreement seeded successfully');
        }
        // Seed retail products
        console.log('\nSeeding retail products...');
        const retailProducts = [
            { sku: 'body-wash', name: 'Body Wash', price: 15, sortOrder: 1, imageUrl: '/images/products/body-wash.png' },
            { sku: 'body-lotion', name: 'Body Lotion', price: 12, sortOrder: 2, imageUrl: '/images/products/body-lotion.png' },
            { sku: 'charcoal-mask', name: 'Charcoal Face Mask', price: 20, sortOrder: 3, imageUrl: '/images/products/charcoal-mask.png' },
            { sku: 'aroma-roll-on', name: 'Aroma Roll-On', price: 12, sortOrder: 4, imageUrl: '/images/products/aroma-roll-on.png' },
            { sku: 'body-scrub', name: 'Exfoliating Scrub', price: 18, sortOrder: 5, imageUrl: '/images/products/body-scrub.png' },
            { sku: 'shampoo', name: 'Shampoo', price: 14, sortOrder: 6, imageUrl: '/images/products/shampoo.png' },
            { sku: 'conditioner', name: 'Conditioner', price: 14, sortOrder: 7, imageUrl: '/images/products/conditioner.png' },
            { sku: 'lip-balm', name: 'Lip Balm', price: 8, sortOrder: 8, imageUrl: '/images/products/lip-balm.png' },
            { sku: 'aloe-gel', name: 'Aloe Vera Gel', price: 10, sortOrder: 9, imageUrl: '/images/products/aloe-gel.png' },
            { sku: 'facial-toner', name: 'Facial Toner', price: 16, sortOrder: 10, imageUrl: '/images/products/facial-toner.png' },
        ];
        for (const product of retailProducts) {
            await index_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO products (sku, name, price, category, sort_order, image_url, is_active)
         VALUES (${product.sku}, ${product.name}, ${product.price}, 'RETAIL', ${product.sortOrder}, ${product.imageUrl}, true)
         ON CONFLICT (sku) DO UPDATE SET
           name       = EXCLUDED.name,
           price      = EXCLUDED.price,
           sort_order = EXCLUDED.sort_order,
           image_url  = EXCLUDED.image_url,
           is_active  = true,
           updated_at = NOW()`);
        }
        console.log(`✅ Retail products seeded (${retailProducts.length} items)`);
    }
    catch (error) {
        console.error('❌ Seed failed:', error);
        throw error;
    }
    finally {
        await (0, index_1.closeDatabase)();
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
