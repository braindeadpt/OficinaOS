// Auto-print helper for the standalone label page (/api/receipts/:id/label).
// External file on purpose: the route's CSP is script-src 'self', which blocks
// inline handlers like onload="window.print()". Runs at end of <body>, but the
// logo image may still be loading — wait for `load` so the print dialog never
// opens on a half-rendered label, and close on `afterprint` instead of a
// fixed timer that could fire before a deferred print dialog appears.
function printAndClose() {
  window.print();
  window.addEventListener("afterprint", () => window.close(), {
    once: true,
  });
  // Fallback for browsers that never fire afterprint.
  setTimeout(() => window.close(), 10_000);
}

if (document.readyState === "complete") {
  printAndClose();
} else {
  window.addEventListener("load", printAndClose, { once: true });
}
