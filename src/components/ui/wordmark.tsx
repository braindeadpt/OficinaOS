/**
 * The OficinaOS wordmark as live text: «Oficina» in the text colour and «OS»
 * in primary, Manrope 800 with tight tracking (design-system.md §2.1). Always
 * written «OficinaOS», never uppercased. The accessible name stays one word.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      aria-label="OficinaOS"
      className={`font-extrabold font-headline text-on-surface tracking-[-0.02em] ${className ?? ""}`}
      role="img"
    >
      <span aria-hidden="true">Oficina</span>
      <span aria-hidden="true" className="text-primary">
        OS
      </span>
    </span>
  );
}
