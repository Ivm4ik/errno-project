/**
 * Demo workspace id. Every browser owns one isolated sandbox on the API, addressed by this
 * random id (sent as `X-Workspace`). It lives in localStorage, so a reload keeps the same ship.
 */

export const WORKSPACE_KEY = "errno:workspace";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomId(length = 20): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

let cached: string | null = null;

/** Browser only. Creates the id on first use. */
export function getWorkspaceId(): string {
  if (cached) return cached;
  let id: string | null = null;
  try {
    id = localStorage.getItem(WORKSPACE_KEY);
  } catch {
    /* storage blocked: fall back to a per-page id */
  }
  if (!id || !/^[A-Za-z0-9]{12,40}$/.test(id)) {
    id = randomId();
    try {
      localStorage.setItem(WORKSPACE_KEY, id);
    } catch {
      /* session-only */
    }
  }
  cached = id;
  return id;
}

/** Short label for the UI, e.g. "A1B2C3". */
export function workspaceLabel(): string {
  return getWorkspaceId().slice(0, 6).toUpperCase();
}

/** Forget this sandbox and start over with a new id (used after a hard reset). */
export function rotateWorkspaceId(): string {
  cached = null;
  try {
    localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    /* ignore */
  }
  return getWorkspaceId();
}
