import fs from 'node:fs';
import path from 'node:path';

function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Lightweight `.env` loader (no external dependency).
 *
 * - Loads from `${process.cwd()}/.env` if present
 * - Does not override existing `process.env` values
 * - Supports basic `KEY=VALUE` lines and comments
 */
export function loadEnvFromDotEnvIfPresent(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const withoutExport = trimmed.startsWith('export ')
        ? trimmed.slice('export '.length)
        : trimmed;
      const eq = withoutExport.indexOf('=');
      if (eq <= 0) continue;

      const key = withoutExport.slice(0, eq).trim();
      const value = stripQuotes(withoutExport.slice(eq + 1));
      if (!key) continue;
      if (process.env[key] != null) continue;
      process.env[key] = value;
    }
  } catch {
    // If the .env is unreadable/malformed, fail "soft" and let normal env lookup continue.
  }
}
