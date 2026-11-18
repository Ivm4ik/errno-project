/**
 * Who is signed in. The token lives in sessionStorage (so two tabs can be two different people)
 * and is mirrored in localStorage (so closing the tab does not sign you out). There are no passwords.
 */

const TOKEN_KEY = "errno:auth-token";
const LAST_KEY = "errno:last-account";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return safe(() => sessionStorage.getItem(TOKEN_KEY), null) ?? safe(() => localStorage.getItem(TOKEN_KEY), null);
}

export function setAuthToken(token: string, login: string) {
  safe(() => sessionStorage.setItem(TOKEN_KEY, token), undefined);
  safe(() => localStorage.setItem(TOKEN_KEY, token), undefined);
  safe(() => localStorage.setItem(LAST_KEY, login), undefined);
}

export function clearAuthToken() {
  safe(() => sessionStorage.removeItem(TOKEN_KEY), undefined);
  safe(() => localStorage.removeItem(TOKEN_KEY), undefined);
}

export function lastAccount(): string | null {
  return safe(() => localStorage.getItem(LAST_KEY), null);
}
