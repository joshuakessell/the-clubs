export type SquareLogLevel = 'info' | 'warn' | 'error';

export function logSquareEvent(
  level: SquareLogLevel,
  event: string,
  meta?: Record<string, unknown>
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    scope: 'integrations.square',
    event,
    ...(meta ?? {}),
  };

  try {
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  } catch {
    // Ignore logging failures.
  }
}
