// Auto-print helper for the standalone label page (/api/receipts/:id/label).
// External file on purpose: the route's CSP is script-src 'self', which blocks
// inline handlers like onload="window.print()". Runs at end of <body>, but the
// logo image may still be loading — wait for `load` so the print dialog never
// opens on a half-rendered label.
//
// The afterprint listener must be registered BEFORE window.print(): some
// engines fire afterprint while print() is still on the stack, and a listener
// added afterwards would miss it. In non-blocking engines the fallback timer
// runs while the dialog is open, so it is deliberately generous — it only
// covers browsers without afterprint at all.
function printAndClose() {
  window.addEventListener("afterprint", () => window.close(), {
    once: true,
  });
  window.print();
  setTimeout(() => window.close(), 60_000);
}

if (document.readyState === "complete") {
  printAndClose();
} else {
  window.addEventListener("load", printAndClose, { once: true });
}
