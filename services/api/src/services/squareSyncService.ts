

import { db } from '../db';
import { customers } from '../db/schema';
import { normalizeToIsoDate } from '../checkin/utils';

export interface SquareCustomer {
  id: string;
  given_name?: string;
  family_name?: string;
  birthday?: string;
  email_address?: string;
  reference_id?: string;
  note?: string;
}

function extractProblemEntries(allCustomers: SquareCustomer[]): SquareCustomer[][] {
  const groups = new Map<string, SquareCustomer[]>();

  for (const c of allCustomers) {
    const fName = (c.given_name || '').trim().toLowerCase();
    const lName = (c.family_name || '').trim().toLowerCase();
    const dob = (c.birthday || '').trim();
    
    // Safety check: a record needs critical fields to even be evaluated as a duplicate safely.
    if (!fName || !lName || !dob) continue; 

    // The strict grouping key
    const key = `${dob}|${fName}|${lName}`;
    
    const group = groups.get(key) || [];
    group.push(c);
    groups.set(key, group);
  }

  // 3. Filter to only groups that have more than 1 entry
  const problemEntries: SquareCustomer[][] = [];
  for (const group of groups.values()) {
    if (group.length > 1) {
      problemEntries.push(group);
    }
  }

  return problemEntries;
}

/**
 * Scans the entire Square customer database via pagination,
 * and groups them into duplicate sets based on an exact match of (DOB + First Name + Last Name).
 */
export async function scanSquareDatabaseForDuplicates(): Promise<{ problemEntries: SquareCustomer[][] }> {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  const baseUrl = env === 'sandbox' 
    ? 'https://connect.squareupsandbox.com' 
    : 'https://connect.squareup.com';

  if (!token) {
    throw new Error('Square access token is not configured in the environment.');
  }

  const allCustomers: SquareCustomer[] = [];
  let cursor: string | undefined = undefined;

  // 1. Paginate through all customers
  do {
    const url = new URL(`${baseUrl}/v2/customers`);
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2023-12-13'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Square API Error: ${response.status} ${response.statusText} - ${errText}`);
    }

    const data: any = await response.json();
    if (data.customers && Array.isArray(data.customers)) {
      allCustomers.push(...data.customers);
    }
    cursor = data.cursor;
  } while (cursor);

  const problemEntries = extractProblemEntries(allCustomers);

  return { problemEntries };
}

export interface SyncResolution {
  masterSquareId: string;
  duplicateSquareIds: string[];
}

async function fetchAllSquareCustomers(baseUrl: string, token: string): Promise<SquareCustomer[]> {
  const allCustomers: SquareCustomer[] = [];
  let cursor: string | undefined = undefined;

  do {
    const url = new URL(`${baseUrl}/v2/customers`);
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2023-12-13'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Square API Error: ${response.status} ${response.statusText} - ${errText}`);
    }

    const data: any = await response.json();
    if (data.customers && Array.isArray(data.customers)) {
      allCustomers.push(...data.customers);
    }
    cursor = data.cursor;
  } while (cursor);

  return allCustomers;
}

async function deleteSquareDuplicates(baseUrl: string, token: string, duplicateIds: string[]): Promise<void> {
  if (duplicateIds.length === 0) return;

  for (let i = 0; i < duplicateIds.length; i += 100) {
    const chunk = duplicateIds.slice(i, i + 100);
    const res = await fetch(`${baseUrl}/v2/customers/bulk-delete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2023-12-13'
      },
      body: JSON.stringify({ customer_ids: chunk })
    });

    if (!res.ok) {
      throw new Error(`Square bulk delete failed: ${await res.text()}`);
    }
  }
}

/**
 * Deletes marked duplicates in Square, fetches the clean list, and mass upserts into PostgreSQL.
 */
export async function executeSquareSync(resolutions: SyncResolution[]): Promise<{ success: boolean; insertedCount: number }> {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  const baseUrl = env === 'sandbox' 
    ? 'https://connect.squareupsandbox.com' 
    : 'https://connect.squareup.com';

  if (!token) {
    throw new Error('Square access token is not configured in the environment.');
  }

  // 1. Delete duplicates in Square
  const allDuplicateIds = resolutions.flatMap(r => r.duplicateSquareIds);
  await deleteSquareDuplicates(baseUrl, token, allDuplicateIds);

  // 2. Fetch the clean list
  const cleanCustomers = await fetchAllSquareCustomers(baseUrl, token);

  // 3. Upsert into PostgreSQL safely using Drizzle
  let insertedCount = 0;
  for (const sc of cleanCustomers) {
    const fName = sc.given_name || '';
    const lName = sc.family_name || '';
    const fullName = `${fName} ${lName}`.trim() || 'Unknown Customer';
    
    // PostgreSQL date() expects a string 'YYYY-MM-DD' natively via Drizzle unless mode: 'date'
    const dobString = normalizeToIsoDate(sc.birthday);
    const refId = sc.reference_id || null;

    if (!sc.id) continue;

    await db.insert(customers).values({
      squareCustomerId: sc.id,
      name: fullName,
      dob: dobString,
      membershipNumber: refId
    }).onConflictDoUpdate({
      target: [customers.squareCustomerId],
      set: {
        name: fullName,
        dob: dobString,
        membershipNumber: refId,
        updatedAt: new Date()
      }
    });

    insertedCount++;
  }

  return { success: true, insertedCount };
}

export interface CreateSquareCustomerParams {
  firstName: string;
  lastName: string;
  dob?: string | null;
  referenceId?: string | null;
}

/**
 * Creates a new customer profile directly in Square.
 */
export async function createSquareCustomer(params: CreateSquareCustomerParams): Promise<string | null> {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  const baseUrl = env === 'sandbox' 
    ? 'https://connect.squareupsandbox.com' 
    : 'https://connect.squareup.com';

  if (!token) {
    console.warn('[SquareSync] Missing SQUARE_ACCESS_TOKEN. Skipping customer creation.');
    return null;
  }

  // The Square POS app shows `given_name` and `family_name` prominently.
  const payload: any = {
    given_name: params.firstName,
    family_name: params.lastName,
  };

  if (params.dob) {
    // Square accepts YYYY-MM-DD for birthday
    payload.birthday = params.dob;
  }
  
  if (params.referenceId) {
    payload.reference_id = params.referenceId;
  }

  try {
    const res = await fetch(`${baseUrl}/v2/customers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2023-12-13'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error(`[SquareSync] Failed to create customer in Square:`, await res.text());
      return null;
    }

    const data: any = await res.json();
    return data.customer?.id || null;
  } catch (err) {
    console.error('[SquareSync] Exception creating customer in Square:', err);
    return null;
  }
}

export interface CreateSquareOrderParams {
  squareCustomerId: string | null;
  lineItems: Array<{
    name: string;
    amountCents: number;
    note?: string;
    catalogObjectId?: string;
  }>;
}

/**
 * Creates a new Order in Square containing the specific items and notes (like Room/Locker number).
 */
export async function createSquareOrder(params: CreateSquareOrderParams): Promise<string | null> {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  const baseUrl = env === 'sandbox' 
    ? 'https://connect.squareupsandbox.com' 
    : 'https://connect.squareup.com';

  if (!token || !locationId) {
    console.warn('[SquareSync] Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID. Skipping order creation.');
    return null;
  }

  // Construct the Square LineItems
  const squareLineItems = params.lineItems.map(item => ({
    name: item.name,
    catalog_object_id: item.catalogObjectId,
    quantity: '1',
    note: item.note,
    base_price_money: {
      amount: Math.round(item.amountCents),
      currency: 'USD'
    }
  }));

  const payload: any = {
    idempotency_key: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).substring(7),
    order: {
      location_id: locationId,
      line_items: squareLineItems
    }
  };

  if (params.squareCustomerId) {
    payload.order.customer_id = params.squareCustomerId;
  }

  try {
    const res = await fetch(`${baseUrl}/v2/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2023-12-13'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error(`[SquareSync] Failed to create order in Square:`, await res.text());
      return null;
    }

    const data: any = await res.json();
    return data.order?.id || null;
  } catch (err) {
    console.error('[SquareSync] Exception creating order in Square:', err);
    return null;
  }
}
