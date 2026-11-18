// Shared by the client theme store and the server layout (no "use client" here).
export const THEME_STORAGE_KEY = "errno:theme";
export const SIDEBAR_STORAGE_KEY = "errno:sidebar";
export const LIGHT_QUERY = "(prefers-color-scheme: light)";
/** Dark mission console is the default. */
export const DEFAULT_THEME = "dark";

/**
 * Runs before first paint so the page never flashes the wrong theme or sidebar width.
 */
export const THEME_INIT_SCRIPT = `(function(){var e=document.documentElement;try{var p=localStorage.getItem("${THEME_STORAGE_KEY}")||"${DEFAULT_THEME}";var t=p==="system"?(matchMedia("${LIGHT_QUERY}").matches?"light":"dark"):p;e.dataset.theme=t;e.style.colorScheme=t;if(localStorage.getItem("${SIDEBAR_STORAGE_KEY}")==="collapsed")e.dataset.sidebar="collapsed";}catch(_){e.dataset.theme="${DEFAULT_THEME}";}})();`;
