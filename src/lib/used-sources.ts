/**
 * Browser-safe helpers for the "FONTI USATE:" marker.
 *
 * The chat prompt asks the model to end every answer with a line like
 * "FONTI USATE: 1, 3" or "FONTI USATE: nessuna". Both the server (when
 * saving the message) and the client (when rendering) use this to:
 *   - strip the marker from the visible text
 *   - keep only the sources the model actually used
 */
export type RefSource = { refs?: number[] };

const MARKER = /\n?\s*\**\s*FONTI\s+USATE\s*:?\**\s*:?\s*([^\n]*)\s*$/i;

/** `used` is null when the model did not write the marker (or it is still streaming). */
export function parseUsedSources(text: string): { clean: string; used: number[] | null } {
  const m = text.match(MARKER);
  if (!m) {
    // Hide a partially-streamed marker at the very end ("FONTI US…").
    const partial = text.match(/\n\s*\**\s*F(O(N(T(I(\s+(U(S(A(T(E)?)?)?)?)?)?)?)?)?)?\s*$/i);
    return { clean: partial ? text.slice(0, partial.index).trimEnd() : text, used: null };
  }
  const used = [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0]));
  return { clean: text.slice(0, m.index).trimEnd(), used };
}

/** Keep only sources whose hit numbers were cited. Without a marker, keep them all. */
export function filterUsed<T extends RefSource>(sources: T[], used: number[] | null): T[] {
  if (used === null) return sources;
  return sources.filter((s) => (s.refs ?? []).some((r) => used.includes(r)));
}
