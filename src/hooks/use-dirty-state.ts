import { useCallback, useEffect, useState } from "react";

export function useDirtyState() {
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());

  const markDirty = useCallback((tab: string, isDirty = true) => {
    setDirtyTabs((prev) => {
      const next = new Set(prev);
      if (isDirty) {
        next.add(tab);
      } else {
        next.delete(tab);
      }
      return next;
    });
  }, []);

  const isDirty = useCallback((tab: string) => dirtyTabs.has(tab), [dirtyTabs]);

  const hasAnyDirty = dirtyTabs.size > 0;

  // Only tab switches inside the settings page are guarded (pendingTab →
  // ConfirmDiscardDialog). Full in-app navigation blocking isn't possible:
  // React Router's useBlocker requires a data router, and the app mounts a
  // plain <BrowserRouter>/<Routes> tree (see src/app.tsx). beforeunload
  // still covers tab close/reload.
  useEffect(() => {
    if (!hasAnyDirty) {
      return;
    }
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasAnyDirty]);

  return { dirtyTabs, markDirty, isDirty, hasAnyDirty };
}
