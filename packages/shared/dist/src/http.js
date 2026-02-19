export async function readJson(response) {
    // Avoid Response.json() throwing on empty bodies or non-JSON responses.
    // Callers should still validate the returned shape.
    if (response.status === 204) {
        return null;
    }
    const contentType = response.headers?.get?.('content-type') || '';
    const hasJson = typeof response.json === 'function';
    // Some unit tests mock fetch responses without implementing the full Response interface.
    // Prefer Response.text() (for better error messages) when available; otherwise fall back to json().
    const hasText = typeof response.text === 'function';
    const text = hasText ? await response.text().catch(() => '') : '';
    const trimmed = text.trim();
    const snippet = trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
    const isJson = contentType.includes('application/json') || (!contentType && hasJson);
    if (!response.ok) {
        if (isJson && trimmed) {
            try {
                return JSON.parse(trimmed);
            }
            catch {
                // fall through to readable error
            }
        }
        throw new Error(`HTTP ${response.status} ${response.statusText}${snippet ? ` — ${snippet}` : ''}`);
    }
    // OK response
    if (!isJson) {
        // Gracefully handle empty bodies (common for some endpoints).
        if (!trimmed)
            return null;
        throw new Error(`Expected JSON but received ${contentType || 'unknown content-type'} — ${snippet}`);
    }
    // If Response.text() isn't available (test mocks), prefer Response.json().
    if (!hasText && hasJson) {
        try {
            return (await response.json());
        }
        catch {
            return null;
        }
    }
    if (!trimmed)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        throw new Error(`Failed to parse JSON — ${snippet || '(empty body)'}`);
    }
}
export function safeJsonParse(input) {
    if (!input)
        return null;
    try {
        return JSON.parse(input);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=http.js.map