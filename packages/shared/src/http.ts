export async function readJson<T>(response: Response): Promise<T> {
  // Avoid Response.json() throwing on empty bodies or non-JSON responses.
  // Callers should still validate the returned shape.
  if (response.status === 204) {
    return null as unknown as T;
  }

  const contentType = response.headers?.get?.('content-type') || '';
  const hasJson = typeof (response as unknown as { json?: unknown }).json === 'function';

  // Some unit tests mock fetch responses without implementing the full Response interface.
  // Prefer Response.text() (for better error messages) when available; otherwise fall back to json().
  const hasText = typeof (response as unknown as { text?: unknown }).text === 'function';
  const text = hasText ? await response.text().catch(() => '') : '';
  const trimmed = text.trim();
  const snippet = trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;

  const isJson = contentType.includes('application/json') || (!contentType && hasJson);

  if (!response.ok) {
    if (isJson && trimmed) {
      try {
        return JSON.parse(trimmed) as T;
      } catch {
        // fall through to readable error
      }
    }
    throw new Error(
      `HTTP ${response.status} ${response.statusText}${snippet ? ` — ${snippet}` : ''}`
    );
  }

  // OK response
  if (!isJson) {
    // Gracefully handle empty bodies (common for some endpoints).
    if (!trimmed) return null as unknown as T;
    throw new Error(
      `Expected JSON but received ${contentType || 'unknown content-type'} — ${snippet}`
    );
  }

  // If Response.text() isn't available (test mocks), prefer Response.json().
  if (!hasText && hasJson) {
    try {
      return (await (response as unknown as { json: () => Promise<unknown> }).json()) as T;
    } catch {
      return null as unknown as T;
    }
  }

  if (!trimmed) return null as unknown as T;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`Failed to parse JSON — ${snippet || '(empty body)'}`);
  }
}

export function safeJsonParse<T>(input: string): T | null {
  if (!input) return null;
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}
