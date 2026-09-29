/**
 * Small ring buffer of recent client-side errors, attached automatically to
 * in-app problem reports so a user never has to copy a stack trace.
 */
const MAX_ENTRIES = 10;
const MAX_LENGTH = 300;

const buffer: string[] = [];
let installed = false;

function push(message: string) {
  buffer.push(message.slice(0, MAX_LENGTH));
  if (buffer.length > MAX_ENTRIES) {
    buffer.shift();
  }
}

export function installErrorBuffer() {
  if (installed) {
    return;
  }
  installed = true;

  window.addEventListener("error", (event) => {
    push(`[error] ${event.message}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    push(`[rejection] ${String(event.reason)}`);
  });

  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    push(`[console.error] ${args.map(String).join(" ")}`);
    original(...args);
  };
}

export function getRecentErrors(): string[] {
  return [...buffer];
}

/** Test-only hook. */
export function __resetErrorBuffer(entries: string[] = []) {
  buffer.length = 0;
  buffer.push(...entries);
}
