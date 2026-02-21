"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seed = seed;
const index_1 = require("./index");
const shared_1 = require("@the-clubs/shared");
const shared_2 = require("@the-clubs/shared");
const utils_1 = require("../auth/utils");
const loadEnv_1 = require("../env/loadEnv");
(0, loadEnv_1.loadEnvFromDotEnvIfPresent)();
/**
 * Seed data for development and testing.
 *
 * IMPORTANT (facility inventory contract):
 * - Lockers: 001..108
 * - Rooms: existing rooms only (nominal 200..262 minus non-existent odd 247..261)
 *
 * This seed enforces inventory presence and removes any invalid legacy rooms/lockers.
 */
const seedRooms = shared_2.ROOMS.map((r) => {
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
const seedLockers = shared_2.LOCKER_NUMBERS.map((n) => ({
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
        const deletedRooms = await (0, index_1.query)(`WITH del AS (
         DELETE FROM rooms
         WHERE NOT (number = ANY($1::text[]))
         RETURNING 1
       )
       SELECT COUNT(*)::text as count FROM del`, [desiredRoomNumbers]);
        if (parseInt(deletedRooms.rows[0]?.count || '0', 10) > 0) {
            console.log(`🧹 Removed ${deletedRooms.rows[0].count} invalid legacy room(s) from inventory`);
        }
        for (const roomSeed of seedRooms) {
            const roomResult = await (0, index_1.query)(`INSERT INTO rooms (number, type, status, floor, last_status_change)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (number) DO UPDATE
           SET type = EXCLUDED.type,
               floor = EXCLUDED.floor,
               updated_at = NOW()
         RETURNING id`, [roomSeed.number, roomSeed.type, shared_1.RoomStatus.CLEAN, roomSeed.floor]);
            const roomId = roomResult.rows[0].id;
            await (0, index_1.query)(`INSERT INTO key_tags (room_id, tag_type, tag_code, is_active)
         VALUES ($1, 'QR', $2, true)
         ON CONFLICT (tag_code) DO UPDATE
           SET room_id = EXCLUDED.room_id,
               locker_id = NULL,
               is_active = true,
               updated_at = NOW()`, [roomId, roomSeed.tagCode]);
        }
        console.log(`\n✅ Rooms inventory ensured (${seedRooms.length} rooms)`);
        // Enforce facility inventory contract (delete any invalid legacy lockers)
        const desiredLockerNumbers = seedLockers.map((l) => l.number);
        const deletedLockers = await (0, index_1.query)(`WITH del AS (
         DELETE FROM lockers
         WHERE NOT (number = ANY($1::text[]))
         RETURNING 1
       )
       SELECT COUNT(*)::text as count FROM del`, [desiredLockerNumbers]);
        if (parseInt(deletedLockers.rows[0]?.count || '0', 10) > 0) {
            console.log(`🧹 Removed ${deletedLockers.rows[0].count} invalid legacy locker(s) from inventory`);
        }
        for (const lockerSeed of seedLockers) {
            const lockerResult = await (0, index_1.query)(`INSERT INTO lockers (number, status)
         VALUES ($1, $2)
         ON CONFLICT (number) DO UPDATE
           SET updated_at = NOW()
         RETURNING id`, [lockerSeed.number, shared_1.RoomStatus.CLEAN]);
            const lockerId = lockerResult.rows[0].id;
            await (0, index_1.query)(`INSERT INTO key_tags (locker_id, tag_type, tag_code, is_active)
         VALUES ($1, 'QR', $2, true)
         ON CONFLICT (tag_code) DO UPDATE
           SET locker_id = EXCLUDED.locker_id,
               room_id = NULL,
               is_active = true,
               updated_at = NOW()`, [lockerId, lockerSeed.tagCode]);
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
            {
                name: 'John Erikson',
                role: 'STAFF',
                qrToken: 'STAFF-001',
                pin: '111111',
            },
            {
                name: 'Manager Club',
                role: 'ADMIN',
                qrToken: 'STAFF-002',
                pin: '222222',
            },
            {
                name: 'Manager Dallas',
                role: 'ADMIN',
                qrToken: 'STAFF-003',
                pin: '333333',
            },
            {
                name: 'Employee One',
                role: 'STAFF',
                qrToken: 'STAFF-004',
                pin: '444444',
            },
            {
                name: 'Employee Two',
                role: 'STAFF',
                qrToken: 'STAFF-005',
                pin: '555555',
            },
        ];
        // Check if staff already exist
        const existingStaff = await (0, index_1.query)('SELECT COUNT(*) as count FROM staff');
        if (parseInt(existingStaff.rows[0]?.count || '0', 10) > 0) {
            console.log('⚠️  Staff users already exist. Updating existing staff to match seed data...');
            // Update existing staff if they match old names or create new ones
            for (const staff of staffUsers) {
                const qrTokenHash = (0, utils_1.hashQrToken)(staff.qrToken);
                const pinHash = await (0, utils_1.hashPin)(staff.pin);
                // Check if staff with this name or matching old names exists
                const existing = await (0, index_1.query)(`SELECT id, name FROM staff 
           WHERE name = $1 
           OR (name = 'John Staff' AND $1 = 'John Erikson')
           OR (name = 'Jane Admin' AND $1 = 'Cruz Martinez')
           LIMIT 1`, [staff.name]);
                if (existing.rows.length > 0) {
                    // Update existing staff
                    await (0, index_1.query)(`UPDATE staff 
             SET name = $1, role = $2, qr_token_hash = $3, pin_hash = $4, active = true
             WHERE id = $5`, [staff.name, staff.role, qrTokenHash, pinHash, existing.rows[0].id]);
                    console.log(`✓ Updated staff: ${existing.rows[0].name} → ${staff.name} (${staff.role})`);
                }
                else {
                    // Create new staff if doesn't exist
                    await (0, index_1.query)(`INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
             VALUES ($1, $2, $3, $4, true)`, [staff.name, staff.role, qrTokenHash, pinHash]);
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
                await (0, index_1.query)(`INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
           VALUES ($1, $2, $3, $4, true)`, [staff.name, staff.role, qrTokenHash, pinHash]);
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
            const existing = await (0, index_1.query)('SELECT COUNT(*) as count FROM devices WHERE device_id = $1', [device.deviceId]);
            if (parseInt(existing.rows[0]?.count || '0', 10) === 0) {
                await (0, index_1.query)(`INSERT INTO devices (device_id, display_name, enabled)
           VALUES ($1, $2, true)`, [device.deviceId, device.displayName]);
                console.log(`✓ Seeded device: ${device.displayName} (${device.deviceId})`);
            }
            else {
                // Update existing device to ensure it's enabled
                await (0, index_1.query)(`UPDATE devices SET enabled = true, display_name = $1 WHERE device_id = $2`, [
                    device.displayName,
                    device.deviceId,
                ]);
                console.log(`✓ Updated device: ${device.displayName} (${device.deviceId})`);
            }
        }
        console.log('✅ Devices seeded successfully');
        // Seed active agreement
        console.log('\nSeeding active agreement...');
        const existingAgreement = await (0, index_1.query)('SELECT COUNT(*) as count FROM agreements WHERE active = true');
        const agreementBodyText = shared_1.AGREEMENT_LEGAL_BODY_HTML_BY_LANG.EN;
        if (parseInt(existingAgreement.rows[0]?.count || '0', 10) > 0) {
            // Update existing active agreement if body_text is empty
            const activeAgreement = await (0, index_1.query)('SELECT body_text FROM agreements WHERE active = true LIMIT 1');
            if (activeAgreement.rows.length > 0 &&
                (!activeAgreement.rows[0]?.body_text || activeAgreement.rows[0].body_text.trim() === '')) {
                await (0, index_1.query)(`UPDATE agreements SET body_text = $1 WHERE active = true`, [
                    agreementBodyText,
                ]);
                console.log('✓ Updated active agreement with real content');
            }
            else {
                console.log('⚠️  Active agreement already exists with content. Skipping agreement seed.');
            }
        }
        else {
            await (0, index_1.query)(`INSERT INTO agreements (version, title, body_text, active)
         VALUES ($1, $2, $3, true)`, ['demo-v1', 'Club Dallas Entry & Liability Waiver (Demo)', agreementBodyText]);
            console.log('✓ Seeded active agreement: demo-v1');
            console.log('✅ Agreement seeded successfully');
        }
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
