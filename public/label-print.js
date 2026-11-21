// Auto-print helper for the standalone label page (/api/receipts/:id/label).
// External file on purpose: the route's CSP is script-src 'self', which blocks
// inline handlers like onload="window.print()". Runs at end of <body>, so the
// DOM is already parsed.
window.print();
setTimeout(() => window.close(), 500);
