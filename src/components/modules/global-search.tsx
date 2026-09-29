import type { JobStatusType } from "@shared/constants";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  isSearchable,
  type SearchResult,
  searchGlobal,
} from "@/lib/global-search";

const DEBOUNCE_MS = 250;
const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;

type LoadState = "error" | "idle" | "loading" | "ready";

/**
 * The shortcut works with both modifiers, so the hint names the one the user
 * actually has. Read once on mount: the platform cannot change under us.
 */
function detectModifierLabel(): string {
  if (typeof navigator === "undefined") {
    return "Ctrl K";
  }
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent;
  return APPLE_PLATFORM.test(platform) ? "⌘K" : "Ctrl K";
}

export default function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const listboxId = useId();
  const inputId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [shortcutLabel] = useState(detectModifierLabel);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Guards against a slow early response overwriting a newer one.
  const requestIdRef = useRef(0);

  // Cmd/Ctrl+K focuses search from anywhere in the app.
  useEffect(() => {
    function onShortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!isSearchable(trimmed)) {
      abortRef.current?.abort();
      requestIdRef.current += 1;
      setResults([]);
      setState("idle");
      setActiveIndex(-1);
      return;
    }

    setState("loading");
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;

      searchGlobal(trimmed, controller.signal)
        .then((found) => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          setResults(found);
          setActiveIndex(found.length > 0 ? 0 : -1);
          setState("ready");
        })
        .catch((err: unknown) => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          // An abort is a superseded request, not a failure.
          if (err instanceof DOMException && err.name === "AbortError") {
            return;
          }
          setResults([]);
          setActiveIndex(-1);
          setState("error");
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onClickOutside(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const select = useCallback(
    (result: SearchResult | undefined) => {
      if (!result) {
        return;
      }
      setOpen(false);
      setQuery("");
      setResults([]);
      setState("idle");
      navigate(result.href);
    },
    [navigate]
  );

  /** Moves the highlighted option, wrapping at both ends. */
  const moveActive = useCallback(
    (target: "end" | "first" | "next" | "previous") => {
      if (results.length === 0) {
        return;
      }
      setOpen(true);
      setActiveIndex((prev) => {
        if (target === "first") {
          return 0;
        }
        if (target === "end") {
          return results.length - 1;
        }
        const delta = target === "next" ? 1 : -1;
        return (prev + delta + results.length) % results.length;
      });
    },
    [results.length]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Home" ||
        e.key === "End"
      ) {
        e.preventDefault();
        const target: Record<string, "end" | "first" | "next" | "previous"> = {
          ArrowDown: "next",
          ArrowUp: "previous",
          End: "end",
          Home: "first",
        };
        moveActive(target[e.key]);
        return;
      }
      if (e.key === "Escape") {
        if (open) {
          setOpen(false);
        } else if (query) {
          setQuery("");
        }
        return;
      }
      if (e.key === "Enter") {
        if (open && results.length > 0) {
          e.preventDefault();
          select(results[activeIndex] ?? results[0]);
        }
        return;
      }
      if (e.key === "Tab") {
        setOpen(false);
      }
    },
    [activeIndex, moveActive, open, query, results, select]
  );

  const showPanel = open && query.trim().length > 0;

  // A header is rendered whenever the group changes, which keeps the option
  // order flat so arrow keys traverse it linearly.
  const rows = useMemo(() => {
    let previousGroup: SearchResult["group"] | null = null;
    return results.map((result) => {
      const header = result.group === previousGroup ? null : result.group;
      previousGroup = result.group;
      return { header, result };
    });
  }, [results]);

  return (
    <div
      className="group relative hidden w-full max-w-xs md:block md:w-96"
      ref={rootRef}
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined absolute start-3 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary"
      >
        search
      </span>
      <input
        aria-activedescendant={
          showPanel && activeIndex >= 0
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        aria-autocomplete="list"
        aria-controls={showPanel && results.length > 0 ? listboxId : undefined}
        aria-expanded={showPanel}
        aria-label={t("search")}
        autoComplete="off"
        className="w-full rounded-full border-none bg-surface-container-high py-2 ps-10 pe-20 text-sm transition-all group-focus-within:pe-4"
        id={inputId}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={t("search")}
        ref={inputRef}
        role="combobox"
        type="text"
        value={query}
      />

      {/*
       * Advertises the shortcut. It only shows while the field is idle and
       * empty, and the input reserves pe-20 for it so the placeholder can
       * never run underneath; on focus-within the padding collapses back to
       * pe-4 because by then the hint is gone and the text wants the room.
       */}
      {!focused && query.length === 0 && (
        <kbd className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 rounded-md bg-surface-container-highest px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant tracking-wide">
          {shortcutLabel}
        </kbd>
      )}

      {showPanel && (
        <div className="absolute start-0 top-full z-50 mt-2 w-full overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl ring-1 ring-outline-variant">
          {state === "loading" && (
            <p
              aria-live="polite"
              className="px-4 py-6 text-center text-on-surface-variant text-sm"
            >
              {t("search_loading")}
            </p>
          )}

          {state === "error" && (
            <p
              className="px-4 py-6 text-center text-error text-sm"
              role="alert"
            >
              {t("search_error")}
            </p>
          )}

          {state === "ready" && results.length === 0 && (
            <p className="px-4 py-6 text-center text-on-surface-variant text-sm">
              {t("search_no_results", { query: query.trim() })}
            </p>
          )}

          {state === "ready" && results.length > 0 && (
            <div
              className="max-h-80 overflow-y-auto py-1"
              id={listboxId}
              role="listbox"
            >
              {rows.map(({ header, result }, index) => (
                <div key={`${result.kind}-${result.id}`}>
                  {header && (
                    <p className="px-4 pt-3 pb-1 font-label text-on-surface-variant text-xs uppercase tracking-wide">
                      {t(header)}
                    </p>
                  )}
                  <button
                    aria-selected={index === activeIndex}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors ${
                      index === activeIndex
                        ? "bg-primary/10"
                        : "hover:bg-surface-container-low"
                    }`}
                    id={`${listboxId}-option-${index}`}
                    onClick={() => select(result)}
                    onMouseEnter={() => setActiveIndex(index)}
                    role="option"
                    type="button"
                  >
                    <span className="material-symbols-outlined shrink-0 text-on-surface-variant">
                      {result.kind === "job" ? "build" : "person"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-on-surface text-sm">
                        {result.title}
                      </span>
                      {result.subtitle && (
                        <span className="block truncate text-on-surface-variant text-xs">
                          {result.subtitle}
                        </span>
                      )}
                    </span>
                    {result.kind === "job" && (
                      <StatusBadge status={result.status as JobStatusType} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
