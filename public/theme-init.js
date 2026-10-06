// Applies the saved appearance before the first paint so a forced light or
// dark theme never flashes the other one (design-system.md §5.1). Loaded as a
// plain same-origin script, which the nonce-based CSP allows without a nonce.
// "system" (or nothing saved) leaves <html> alone: tokens.css follows
// prefers-color-scheme on its own. Keep the key in sync with src/lib/theme.ts.
try {
  var t = localStorage.getItem("oos-theme");
  if (t === "light" || t === "dark") {
    document.documentElement.dataset.theme = t;
  }
} catch (_) {
  // Storage blocked (private mode, policy): follow the system.
}
