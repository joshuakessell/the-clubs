export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const err = value['error'];
  const msg = value['message'];
  if (typeof err === 'string' && err.trim()) return err;
  if (typeof msg === 'string' && msg.trim()) return msg;
  return undefined;
}
