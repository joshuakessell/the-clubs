import { getDb } from '../db';
import { staff, staffSessions, timeclockSessions } from '../db/schema/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { verifyPin, generateSessionToken, getSessionExpiry, hashSessionToken } from '../auth/utils';
import { insertAuditLogDrizzle } from '../audit/auditLog';

export async function listActiveStaff(isDemoMode: boolean) {
  const drizzleDb = getDb();
  return drizzleDb.query.staff.findMany({
    where: (staff, { eq, and, isNotNull }) => and(
      eq(staff.active, true),
      isDemoMode ? undefined : isNotNull(staff.pinHash)
    ),
    columns: { id: true, name: true, role: true },
    orderBy: (staff, { asc }) => [asc(staff.name)],
  });
}

interface LoginResult {
  staffId: string;
  name: string;
  role: string;
  sessionToken: string;
  mustChangePin: boolean;
  sessionId: string;
}

export async function loginWithPin(
  staffLookup: string,
  pin: string,
  deviceId: string,
  deviceType: string,
  isDemoMode: boolean
): Promise<LoginResult | null> {
  const drizzleDb = getDb();
  
  return drizzleDb.transaction(async (tx) => {
    const staffRow = await tx.query.staff.findFirst({
      where: (staff, { or, eq, ilike, and, sql }) => and(
        or(
          sql`${staff.id}::text = ${staffLookup}`,
          ilike(staff.name, staffLookup)
        ),
        eq(staff.active, true),
        isDemoMode ? undefined : sql`${staff.pinHash} IS NOT NULL`
      )
    });

    if (!staffRow) return null;

    if (!isDemoMode) {
      if (!staffRow.pinHash || !(await verifyPin(pin, staffRow.pinHash))) {
        return null;
      }
    }

    const sessionToken = generateSessionToken();
    const expiresAt = getSessionExpiry();
    const tokenHash = hashSessionToken(sessionToken);

    const [session] = await tx.insert(staffSessions).values({
      staffId: staffRow.id,
      deviceId,
      deviceType: deviceType || 'tablet',
      sessionToken: tokenHash,
      expiresAt: expiresAt.toISOString(),
    }).returning({ id: staffSessions.id });

    if (!session) throw new Error("Failed to create session");

    await insertAuditLogDrizzle(tx, {
      staffId: staffRow.id,
      action: 'STAFF_LOGIN_PIN',
      entityType: 'staff_session',
      entityId: session.id,
    });
    
    try {
      const activeRegister = await tx.query.registerSessions.findFirst({
        where: (s, { eq, and, isNull }) => and(
          eq(s.employeeId, staffRow.id),
          isNull(s.signedOutAt)
        )
      });
      
      if (!activeRegister) {
        const now = new Date();
        const activeTimeclock = await tx.query.timeclockSessions.findFirst({
          where: (t, { eq, and, isNull }) => and(
            eq(t.employeeId, staffRow.id),
            isNull(t.clockOutAt)
          )
        });
        
        let shiftId: string | null = null;
        try {
          const shift = await tx.query.employeeShifts.findFirst({
            where: (s, { eq, and, ne, sql }) => and(
              eq(s.employeeId, staffRow.id),
              ne(s.status, 'CANCELED'),
              sql`((starts_at <= ${now.toISOString()}::timestamptz AND ends_at >= ${now.toISOString()}::timestamptz) OR (starts_at > ${now.toISOString()}::timestamptz AND starts_at <= ${now.toISOString()}::timestamptz + INTERVAL '60 minutes'))`
            ),
            orderBy: (s, { sql, asc }) => [asc(sql`ABS(EXTRACT(EPOCH FROM (starts_at - ${now.toISOString()}::timestamptz)))`)]
          });
          shiftId = shift?.id ?? null;
        } catch { /* best-effort shift lookup */ }

        if (!activeTimeclock) {
          await tx.insert(timeclockSessions).values({
            employeeId: staffRow.id,
            shiftId,
            clockInAt: now.toISOString(),
            source: 'OFFICE_DASHBOARD',
          });
        } else if (shiftId && !activeTimeclock.shiftId) {
          await tx.update(timeclockSessions)
            .set({ shiftId })
            .where(eq(timeclockSessions.id, activeTimeclock.id));
        }
      }
    } catch { /* best-effort auto-clock-in; never block login */ }

    return {
      staffId: staffRow.id,
      name: staffRow.name,
      role: staffRow.role,
      sessionToken,
      mustChangePin: staffRow.forcePinChange,
      sessionId: session.id,
    };
  });
}

export async function changeStaffPin(
  staffId: string,
  currentPin: string | undefined,
  newPin: string
): Promise<void> {
  const drizzleDb = getDb();
  
  await drizzleDb.transaction(async (tx) => {
    const staffRow = await tx.query.staff.findFirst({
      where: (staff, { eq, and }) => and(
        eq(staff.id, staffId),
        eq(staff.active, true)
      )
    });

    if (!staffRow) throw new Error("Unauthorized");

    if (!staffRow.forcePinChange) {
      if (!currentPin) throw new Error("Current PIN is required");
      if (!staffRow.pinHash || !(await verifyPin(currentPin, staffRow.pinHash))) {
        throw new Error("Current PIN is incorrect");
      }
      if (newPin === currentPin) {
        throw new Error("New PIN must be different from current PIN");
      }
    }

    const { hashPin } = await import('../auth/utils');
    const newPinHash = await hashPin(newPin);

    await tx.update(staff)
      .set({ pinHash: newPinHash, forcePinChange: false, updatedAt: new Date().toISOString() })
      .where(eq(staff.id, staffId));
      
    await insertAuditLogDrizzle(tx, {
      staffId,
      action: 'STAFF_PIN_RESET',
      entityType: 'staff',
      entityId: staffId,
      metadata: { selfChange: true, forced: staffRow.forcePinChange },
    });
  });
}

export async function logoutSession(tokenHash: string): Promise<void> {
  const drizzleDb = getDb();
  
  await drizzleDb.transaction(async (tx) => {
    const session = await tx.query.staffSessions.findFirst({
      where: (s, { eq, and, isNull }) => and(
        eq(s.sessionToken, tokenHash),
        isNull(s.revokedAt)
      )
    });
    
    if (!session) return;
    
    await tx.update(staffSessions)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(staffSessions.id, session.id));
      
    await insertAuditLogDrizzle(tx, {
      staffId: session.staffId,
      action: 'STAFF_LOGOUT',
      entityType: 'staff_session',
      entityId: session.id,
    });
    
    try {
      const otherRegister = await tx.query.registerSessions.findFirst({
        where: (s, { eq, and, isNull }) => and(
          eq(s.employeeId, session.staffId),
          isNull(s.signedOutAt)
        )
      });
      
      const otherStaffSession = await tx.query.staffSessions.findFirst({
        where: (s, { eq, and, isNull, gt }) => and(
          eq(s.staffId, session.staffId),
          isNull(s.revokedAt),
          gt(s.expiresAt, new Date().toISOString())
        )
      });
      
      if (!otherRegister && !otherStaffSession) {
        await tx.update(timeclockSessions)
          .set({ clockOutAt: new Date().toISOString() })
          .where(and(eq(timeclockSessions.employeeId, session.staffId), isNull(timeclockSessions.clockOutAt)));
      }
    } catch { /* best-effort auto-clock-out; never block logout */ }
  });
}

export async function reauthWithPin(
  staffId: string,
  pin: string,
  tokenHash: string
): Promise<Date> {
  const drizzleDb = getDb();
  
  return drizzleDb.transaction(async (tx) => {
    const staffRow = await tx.query.staff.findFirst({
      where: (staff, { eq, and }) => and(
        eq(staff.id, staffId),
        eq(staff.active, true)
      )
    });

    if (!staffRow?.pinHash || !(await verifyPin(pin, staffRow.pinHash))) {
      throw new Error("Invalid credentials");
    }

    const session = await tx.query.staffSessions.findFirst({
      where: (s, { eq, and, isNull }) => and(
        eq(s.sessionToken, tokenHash),
        isNull(s.revokedAt)
      )
    });

    if (!session) throw new Error("Session not found");

    const reauthOkUntil = new Date(Date.now() + 5 * 60 * 1000);
    
    await tx.update(staffSessions)
      .set({ reauthOkUntil: reauthOkUntil.toISOString() })
      .where(eq(staffSessions.id, session.id));
      
    await insertAuditLogDrizzle(tx, {
      staffId,
      action: 'STAFF_REAUTH_PIN',
      entityType: 'staff_session',
      entityId: session.id,
    });

    return reauthOkUntil;
  });
}

export async function getReauthWebauthnOptions(staffId: string, deviceId: string) {
  const { generateAuthenticationOptions } = await import('@simplewebauthn/server');
  const { getRpId, generateChallenge, storeChallenge, getStaffCredentials } = await import('../auth/webauthn.js');
  
  const rpId = getRpId();
  const credentials = await getStaffCredentials(staffId);
  
  if (credentials.length === 0) {
    throw new Error("No passkeys registered for this staff member");
  }
  
  const challenge = generateChallenge();
  await storeChallenge(challenge, staffId, deviceId, 'reauth');
  
  return generateAuthenticationOptions({
    rpID: rpId,
    timeout: 120000,
    allowCredentials: credentials.map((cred) => ({
      id: cred.credentialID,
      type: 'public-key',
      transports: cred.transports,
    })),
    userVerification: 'required',
  });
}

export async function verifyReauthWebauthn(
  staffId: string,
  deviceId: string,
  tokenHash: string,
  origin: string,
  credentialResponse: any
): Promise<Date> {
  const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');
  const { getRpId, getRpOrigin, consumeChallenge, getCredentialByCredentialId, updateCredentialSignCount } = await import('../auth/webauthn.js');

  const rpId = getRpId();
  const rpOrigin = getRpOrigin(origin);
  const drizzleDb = getDb();

  return drizzleDb.transaction(async (tx) => {
    const challengeRow = await tx.query.webauthnChallenges.findFirst({
      where: (c, { eq, and, gt }) => and(
        eq(c.staffId, staffId),
        eq(c.deviceId, deviceId),
        eq(c.type, 'reauth'),
        gt(c.expiresAt, new Date().toISOString())
      ),
      orderBy: (c, { desc }) => [desc(c.createdAt)]
    });

    if (!challengeRow) throw new Error("Invalid or expired challenge");

    await consumeChallenge(challengeRow.challenge);

    const credentialId = credentialResponse.id || credentialResponse.rawId || '';
    const credentialData = await getCredentialByCredentialId(credentialId);

    if (!credentialData) throw new Error("Credential not found");

    const verification = await verifyAuthenticationResponse({
      response: credentialResponse,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: rpOrigin,
      expectedRPID: rpId,
      authenticator: credentialData.credential,
      requireUserVerification: true,
    });

    if (!verification.verified) throw new Error("Authentication verification failed");

    if (verification.authenticationInfo) {
      await updateCredentialSignCount(credentialId, verification.authenticationInfo.newCounter);
    }

    const session = await tx.query.staffSessions.findFirst({
      where: (s, { eq, and, isNull }) => and(
        eq(s.sessionToken, tokenHash),
        isNull(s.revokedAt)
      )
    });

    if (!session) throw new Error("Session not found");

    const reauthOkUntil = new Date(Date.now() + 5 * 60 * 1000);
    
    await tx.update(staffSessions)
      .set({ reauthOkUntil: reauthOkUntil.toISOString() })
      .where(eq(staffSessions.id, session.id));

    await insertAuditLogDrizzle(tx, {
      staffId,
      action: 'STAFF_REAUTH_WEBAUTHN',
      entityType: 'staff_session',
      entityId: session.id,
    });

    return reauthOkUntil;
  });
}
