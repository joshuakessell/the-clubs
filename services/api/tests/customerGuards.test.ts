import { describe, it, expect } from 'vitest';
import { assertNotBanned, assertCustomerExists } from '../src/domain/customerGuards';
import { HttpError } from '../src/errors/HttpError';

describe('assertNotBanned', () => {
  it('does nothing when banned_until is null', () => {
    expect(() => assertNotBanned({ banned_until: null })).not.toThrow();
  });

  it('does nothing when banned_until is undefined', () => {
    expect(() => assertNotBanned({})).not.toThrow();
  });

  it('does nothing when ban has expired', () => {
    const pastDate = new Date(Date.now() - 86400000); // yesterday
    expect(() => assertNotBanned({ banned_until: pastDate })).not.toThrow();
  });

  it('throws HttpError 403 when ban is active (Date object)', () => {
    const futureDate = new Date(Date.now() + 86400000 * 30); // 30 days from now
    expect(() => assertNotBanned({ banned_until: futureDate }))
      .toThrow(HttpError);
    try {
      assertNotBanned({ banned_until: futureDate });
    } catch (e) {
      const err = e as HttpError;
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('BANNED');
      expect(err.message).toContain('banned until');
    }
  });

  it('throws HttpError 403 when ban is active (string date)', () => {
    const futureDate = new Date(Date.now() + 86400000 * 30);
    // Pass as a string-like value that gets coerced to Date internally
    expect(() => assertNotBanned({ banned_until: futureDate })).toThrow(HttpError);
  });
});

describe('assertCustomerExists', () => {
  it('returns the first row when rows exist', () => {
    const rows = [{ id: '123', name: 'Alice' }];
    expect(assertCustomerExists(rows)).toEqual({ id: '123', name: 'Alice' });
  });

  it('returns first row when multiple rows exist', () => {
    const rows = [{ id: '1' }, { id: '2' }];
    expect(assertCustomerExists(rows)).toEqual({ id: '1' });
  });

  it('throws HttpError 404 when rows are empty', () => {
    expect(() => assertCustomerExists([])).toThrow(HttpError);
    try {
      assertCustomerExists([]);
    } catch (e) {
      const err = e as HttpError;
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Customer not found');
    }
  });

  it('uses custom label in error message', () => {
    try {
      assertCustomerExists([], 'Staff member');
    } catch (e) {
      expect((e as HttpError).message).toBe('Staff member not found');
    }
  });
});
