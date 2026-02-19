import { describe, it, expect } from 'vitest';
import { getApiUrl } from '../src/apiBase';

// Note: normalizeApiBaseUrl is not exported, so we test it indirectly through getApiUrl.
// API_BASE_URL is evaluated at module load time, so we test getApiUrl behavior which
// exercises both normalizeApiBaseUrl and the path stripping logic.

describe('getApiUrl', () => {
  // When API_BASE_URL is empty (local dev), paths are returned as-is.
  // API_BASE_URL is '' in test environment since VITE_API_BASE_URL is not set.

  it('returns path as-is when API_BASE_URL is empty (local dev proxy)', () => {
    // In test env, API_BASE_URL is '' because VITE_API_BASE_URL is not set
    expect(getApiUrl('/api/checkin')).toBe('/api/checkin');
  });

  it('handles /api path alone', () => {
    expect(getApiUrl('/api')).toBe('/api');
  });

  it('handles paths without /api prefix', () => {
    expect(getApiUrl('/health')).toBe('/health');
  });

  it('handles empty path', () => {
    expect(getApiUrl('')).toBe('');
  });
});
