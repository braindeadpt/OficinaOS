import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { StatusBadge } from "@/components/ui/status-badge";
import { useModalEffects } from "@/hooks/use-modal-effects";
import { useShortcutLabel } from "@/hooks/use-shortcut-label";
import { buildCommands, filterCommands } from "@/lib/command-items";
import {
  isSearchable,
  type SearchResult,
  searchGlobal,
} from "@/lib/global-search";
import { useAuthStore } from "@/stores/auth";
import { useCommandPaletteStore } from "@/stores/command-palette";
import { useUiStore } from "@/stores/ui";

const DEBOUNCE_MS = 200;

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

type LoadState = "error" | "idle" | "loading" | "ready";

/**
 * Where the keyboard moves the selection, wrapping at both ends so the list
 * can be cycled without reaching for the mouse. Split out of the key handler
 * to keep that handler readable, and pure so it can be reasoned about.
 */
export function nextIndexFor(
  key: string,
  current: number,
  total: number
): number {
  if (total === 0) {
    return 0;
  }
  if (key === "ArrowDown") {
    return (current + 1) % total;
  }
  if (key === "ArrowUp") {
    return (current - 1 + total) % total;
  }
  if (key === "Home") {
    return 0;
  }
  return total - 1;
}

/**
 * Global command palette.
 *
 * Mounted once at the app root rather than inside a layout, so Cmd+K opens it
 * from the AI analyst screens and the job detail page as well as from the
 * dashboard, and so it is not torn down and rebuilt on every navigation.
 *
 * Offers the navigation registry, a few actions, and the job/customer lookup
 * that used to live in the top bar. Below MIN_QUERY_LENGTH only the static
 * commands show, so simply opening the palette never fires a request.
 */
export default function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  const openPalette = useCommandPaletteStore((s) => s.open);
  const closePalette = useCommandPaletteStore((s) => s.close);
  const role = useAuthStore((s) => s.role);
  const logout = useAuthStore((s) => s.logout);
  const openIntakeModal = useUiStore((s) => s.openIntakeModal);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [signOutArmed, setSignOutArmed] = useState(false);
  const shortcutLabel = useShortcutLabel();

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Guards against a slow early response overwriting a newer one.
  const requestIdRef = useRef(0);
  const signOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    closePalette();
    setSignOutArmed(false);
  }, [closePalette]);

  // The palette handles Escape itself: the first press clears the filter and
  // only the second closes.
  useModalEffects(isOpen, close, inputRef, { closeOnEscape: false });

  /**
   * Two-step sign out, mirroring the sidebar: the first press arms it and the
   * second acts. Without this, a stray Enter in a palette full of one-key
   * commands could end someone's session.
   */
  const signOut = useCallback(() => {
    if (!signOutArmed) {
      setSignOutArmed(true);
      signOutTimerRef.current = setTimeout(() => setSignOutArmed(false), 3000);
      return true;
    }
    logout();
    return false;
  }, [logout, signOutArmed]);

  useEffect(
    () => () => {
      if (signOutTimerRef.current) {
        clearTimeout(signOutTimerRef.current);
      }
    },
    []
  );

  const commands = useMemo(
    () => buildCommands({ logout, navigate, openIntakeModal, role, signOut }),
    [logout, navigate, openIntakeModal, role, signOut]
  );

  const matched = useMemo(
    () => filterCommands(commands, query, t),
    [commands, query, t]
  );

  // Records only mean something once there is a term to match, and the static
  // list is exactly what someone wants on first open.
  const showRecords = isSearchable(query);

  useEffect(() => {
    if (!(isOpen && showRecords)) {
      abortRef.current?.abort();
      requestIdRef.current += 1;
      setResults([]);
      setState("idle");
      return;
    }

    const timer = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      setState("loading");

      searchGlobal(query, controller.signal)
        .then((found) => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          setResults(found);
          setState("ready");
        })
        .catch(() => {
          if (requestId === requestIdRef.current) {
            setResults([]);
            setState("error");
          }
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [isOpen, query, showRecords]);

  const total = matched.length + (showRecords ? results.length : 0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: isOpen is read on purpose — reopening must reset the highlight even when the query is unchanged
  useEffect(() => {
    setActiveIndex(0);
  }, [isOpen, query]);

  // Scoped to Cmd/Ctrl+K so it does not fight a browser or OS binding. When
  // the palette is already open the same chord closes it, which is what a
  // toggle is expected to do.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        !e.isComposing &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        if (useCommandPaletteStore.getState().isOpen) {
          close();
        } else {
          setQuery("");
          openPalette();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, openPalette]);

  const runAt = useCallback(
    (index: number) => {
      if (index < matched.length) {
        const command = matched[index];
        // A command may report that it has not finished yet, which is how the
        // two-step sign out asks to stay open until the second press.
        if (command.run() !== true) {
          close();
        }
        return;
      }
      const record = results[index - matched.length];
      if (record) {
        navigate(record.href);
        close();
      }
    },
    [close, matched, navigate, results]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (NAV_KEYS.has(e.key)) {
        e.preventDefault();
        setActiveIndex((prev) => nextIndexFor(e.key, prev, total));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        runAt(activeIndex);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // First Escape clears the filter, second closes: how a search field is
        // expected to behave, and it keeps the palette useful while iterating.
        if (query) {
          setQuery("");
        } else {
          close();
        }
      }
    },
    [activeIndex, close, query, runAt, total]
  );

  useEffect(() => {
    // scrollIntoView is missing in jsdom, hence the second guard.
    const row = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  if (!isOpen) {
    return null;
  }

  const actionCommands = matched.filter((c) => c.kind === "action");
  const pageCommands = matched.filter((c) => c.kind === "page");
  let rowIndex = -1;
  const optionId = (index: number) => `command-palette-option-${index}`;

  return (
    <div
      aria-label={t("command_palette.title")}
      aria-modal="true"
      className="fixed inset-0 z-100 flex items-start justify-center p-4 pt-[10vh]"
      role="dialog"
    >
      <button
        aria-label={t("command_palette.close")}
        className="absolute inset-0 -z-10 cursor-default bg-black/50 backdrop-blur-sm"
        onClick={close}
        tabIndex={-1}
        type="button"
      />
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl ring-1 ring-outline-variant">
        <div className="flex items-center gap-3 border-outline-variant border-b px-4">
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-on-surface-variant"
          >
            search
          </span>
          <input
            aria-activedescendant={
              total > 0 ? optionId(activeIndex) : undefined
            }
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            aria-expanded={total > 0}
            aria-label={t("command_palette.placeholder")}
            autoComplete="off"
            className="w-full bg-transparent py-4 text-base text-on-surface focus:outline-none"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("command_palette.placeholder")}
            ref={inputRef}
            role="combobox"
            type="text"
            value={query}
          />
          <kbd className="pointer-events-none shrink-0 rounded-md bg-surface-container-highest px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
            Esc
          </kbd>
        </div>

        <div
          className="max-h-[55vh] overflow-y-auto py-2"
          id="command-palette-list"
          ref={listRef}
          role="listbox"
        >
          {total === 0 && (
            <p className="px-4 py-8 text-center text-on-surface-variant text-sm">
              {t("command_palette.no_results", { query: query.trim() })}
            </p>
          )}

          {actionCommands.length > 0 && (
            <CommandGroup label={t("command_palette.group_actions")}>
              {actionCommands.map((command) => {
                rowIndex += 1;
                const isSignOut = command.labelKey === "auth_sign_out_instead";
                return (
                  <CommandRow
                    active={rowIndex === activeIndex}
                    hint={
                      isSignOut && signOutArmed
                        ? t("auth_sign_out_confirm")
                        : undefined
                    }
                    icon={isSignOut ? "logout" : "bolt"}
                    id={optionId(rowIndex)}
                    index={rowIndex}
                    key={`action-${command.labelKey}`}
                    label={command.label}
                    onHover={setActiveIndex}
                    onSelect={runAt}
                  />
                );
              })}
            </CommandGroup>
          )}

          {pageCommands.length > 0 && (
            <CommandGroup label={t("command_palette.group_pages")}>
              {pageCommands.map((command) => {
                rowIndex += 1;
                return (
                  <CommandRow
                    active={rowIndex === activeIndex}
                    icon="chevron_right"
                    id={optionId(rowIndex)}
                    index={rowIndex}
                    key={`page-${command.to}`}
                    label={command.label}
                    onHover={setActiveIndex}
                    onSelect={runAt}
                  />
                );
              })}
            </CommandGroup>
          )}

          {showRecords && state === "loading" && (
            <p
              aria-live="polite"
              className="px-4 py-6 text-center text-on-surface-variant text-sm"
            >
              {t("command_palette.searching")}
            </p>
          )}

          {showRecords && state === "error" && (
            <p
              className="px-4 py-6 text-center text-error text-sm"
              role="alert"
            >
              {t("command_palette.search_error")}
            </p>
          )}

          {showRecords && state === "ready" && results.length === 0 && (
            <p className="px-4 py-6 text-center text-on-surface-variant text-sm">
              {t("command_palette.no_records")}
            </p>
          )}

          {showRecords && results.length > 0 && (
            <CommandGroup label={t("command_palette.group_records")}>
              {results.map((record) => {
                rowIndex += 1;
                return (
                  <RecordRow
                    active={rowIndex === activeIndex}
                    id={optionId(rowIndex)}
                    index={rowIndex}
                    key={`${record.kind}-${record.id}`}
                    onHover={setActiveIndex}
                    onSelect={runAt}
                    record={record}
                  />
                );
              })}
            </CommandGroup>
          )}
        </div>

        <div className="flex items-center gap-4 border-outline-variant border-t px-4 py-2 text-[11px] text-on-surface-variant">
          <Hint keys="↑ ↓">{t("command_palette.hint_navigate")}</Hint>
          <Hint keys="↵">{t("command_palette.hint_run")}</Hint>
          <span className="ms-auto flex items-center gap-1.5">
            <kbd className="rounded bg-surface-container-highest px-1 font-mono">
              {shortcutLabel}
            </kbd>
            {t("command_palette.hint_toggle")}
          </span>
        </div>
      </div>
    </div>
  );
}

function Hint({ children, keys }: { children: ReactNode; keys: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {keys.split(" ").map((key) => (
        <kbd
          className="rounded bg-surface-container-highest px-1 font-mono"
          key={key}
        >
          {key}
        </kbd>
      ))}
      {children}
    </span>
  );
}

function CommandGroup({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: role="group" is the grouping role inside a listbox; fieldset would imply a form
    <div aria-label={label} role="group">
      <p className="px-4 pt-3 pb-1 font-label text-on-surface-variant text-xs uppercase tracking-wide">
        {label}
      </p>
      {children}
    </div>
  );
}

const ROW_BASE =
  "flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors";
const ROW_ACTIVE = "bg-primary/10";
const ROW_IDLE = "hover:bg-surface-container-low";

function CommandRow({
  active,
  hint,
  icon,
  id,
  index,
  label,
  onHover,
  onSelect,
}: {
  active: boolean;
  hint?: string;
  icon: string;
  id: string;
  index: number;
  label: string;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
}) {
  return (
    <button
      aria-selected={active}
      className={`${ROW_BASE} ${active ? ROW_ACTIVE : ROW_IDLE}`}
      data-index={index}
      id={id}
      onClick={() => onSelect(index)}
      onMouseMove={() => onHover(index)}
      role="option"
      type="button"
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-on-surface-variant"
      >
        {icon}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          hint ? "font-bold text-error" : "text-on-surface"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

function RecordRow({
  active,
  id,
  index,
  onHover,
  onSelect,
  record,
}: {
  active: boolean;
  id: string;
  index: number;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
  record: SearchResult;
}) {
  return (
    <button
      aria-selected={active}
      className={`${ROW_BASE} ${active ? ROW_ACTIVE : ROW_IDLE}`}
      data-index={index}
      id={id}
      onClick={() => onSelect(index)}
      onMouseMove={() => onHover(index)}
      role="option"
      type="button"
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-on-surface-variant"
      >
        {record.kind === "job" ? "build" : "person"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-on-surface text-sm">
          {record.title}
        </span>
        {record.subtitle && (
          <span className="block truncate text-on-surface-variant text-xs">
            {record.subtitle}
          </span>
        )}
      </span>
      {record.kind === "job" && <StatusBadge status={record.status} />}
    </button>
  );
}
