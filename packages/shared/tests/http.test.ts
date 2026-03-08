import { describe, it, expect } from 'vitest';
import { readJson, safeJsonParse } from '../src/http';

// ── readJson ──────────────────────────────────────────────────────────────────

describe('readJson', () => {
  it('returns null for 204 No Content', async () => {
    const response = {
      status: 204,
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => '',
      json: async () => null,
    } as unknown as Response;
    const result = await readJson(response);
    expect(result).toBeNull();
  });

  it('parses JSON body on ok response', async () => {
    const response = {
      status: 200,
      ok: true,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      text: async () => '{"name":"Alice"}',
      json: async () => ({ name: 'Alice' }),
    } as unknown as Response;
    const result = await readJson<{ name: string }>(response);
    expect(result).toEqual({ name: 'Alice' });
  });

  it('throws on non-ok response with JSON error body', async () => {
    const response = {
      status: 400,
      ok: false,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      text: async () => '{"error":"Bad input"}',
    } as unknown as Response;
    // readJson returns the parsed error body on non-ok JSON responses
    const result = await readJson(response);
    expect(result).toEqual({ error: 'Bad input' });
  });

  it('throws on non-ok response with non-JSON body', async () => {
    const response = {
      status: 500,
      ok: false,
      statusText: 'Server Error',
      headers: { get: () => 'text/html' },
      text: async () => '<html>Error</html>',
    } as unknown as Response;
    await expect(readJson(response)).rejects.toThrow('HTTP 500');
  });

  it('returns null for ok response with empty body', async () => {
    const response = {
      status: 200,
      ok: true,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      text: async () => '',
    } as unknown as Response;
    const result = await readJson(response);
    expect(result).toBeNull();
  });

  it('throws on non-JSON content type for ok response with body', async () => {
    const response = {
      status: 200,
      ok: true,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: async () => 'plain text body',
    } as unknown as Response;
    await expect(readJson(response)).rejects.toThrow('Expected JSON');
  });

  it('handles response without text() (falls back to json())', async () => {
    const response = {
      status: 200,
      ok: true,
      statusText: 'OK',
      headers: { get: () => '' },
      json: async () => ({ fallback: true }),
    } as unknown as Response;
    const result = await readJson(response);
    expect(result).toEqual({ fallback: true });
  });
});

// ── safeJsonParse ─────────────────────────────────────────────────────────────

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for invalid JSON', () => {
    expect(safeJsonParse('not json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(safeJsonParse('')).toBeNull();
  });

  it('parses JSON array', () => {
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses JSON string', () => {
    expect(safeJsonParse('"hello"')).toBe('hello');
  });
});
