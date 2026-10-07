import { useCallback, useEffect, useRef, useState } from "react";
import api, { type ApiError } from "@/lib/api";

export interface ModelSearchResult {
  brandId: string;
  category: string | null;
  id: string;
  model: string;
}

export function useModelSearch(brandId: string, debounceMs = 250) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModelSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (q: string) => {
      if (!brandId) {
        setResults([]);
        setIsSearching(false);
        return;
      }
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsSearching(true);
      try {
        const res = await api.get(`/brands/${brandId}/models/search`, {
          params: { q, limit: 20 },
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        setResults(res.data.models as ModelSearchResult[]);
        setSearchError(false);
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setResults([]);
        setSearchError(true);
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    },
    [brandId]
  );

  useEffect(() => {
    if (!brandId) {
      setResults([]);
      setQuery("");
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      search(query);
    }, debounceMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [query, brandId, debounceMs, search]);

  const clear = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
    setQuery("");
    setResults([]);
    setSearchError(false);
    setCreateError(null);
  }, []);

  const createModel = useCallback(
    async (
      modelName: string,
      category?: string
    ): Promise<ModelSearchResult | null> => {
      if (!brandId) {
        return null;
      }
      setIsCreating(true);
      setCreateError(null);
      try {
        const res = await api.post(`/brands/${brandId}/models`, {
          category,
          model: modelName,
        });
        const device = res.data as ModelSearchResult;
        setResults((prev) => [...prev, device]);
        return device;
      } catch (err: unknown) {
        const apiErr = err as Partial<ApiError>;
        setCreateError(apiErr?.message ?? "Failed to add model");
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    [brandId]
  );

  return {
    clear,
    createError,
    createModel,
    isCreating,
    isSearching,
    query,
    results,
    search,
    searchError,
    setQuery,
  };
}
