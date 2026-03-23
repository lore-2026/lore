'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'lore:letterboxdImportStatus:v1';

const ImportStatusContext = createContext(null);

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const initialState = {
  flow: 'letterboxd',
  state: 'idle', // idle | running | done | error
  total: 0,
  processed: 0,
  successful: 0,
  skipped: 0,
  failed: 0,
  lastTitle: '',
  startedAt: null,
  finishedAt: null,
  error: '',
};

export function ImportStatusProvider({ children }) {
  // Must match server first paint: never read localStorage in useState (avoids hydration mismatch).
  const [status, setStatus] = useState(initialState);
  const skipFirstPersist = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? safeParse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      const next = { ...initialState, ...parsed };
      // Defer so this isn’t synchronous setState inside the effect (react-hooks/set-state-in-effect).
      queueMicrotask(() => setStatus(next));
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false;
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
  }, [status]);

  const startLetterboxdImport = useCallback(({ total }) => {
    setStatus({
      ...initialState,
      state: 'running',
      total: Number(total) || 0,
      startedAt: Date.now(),
    });
  }, []);

  const updateLetterboxdImport = useCallback((patch) => {
    setStatus((prev) => ({
      ...prev,
      ...patch,
      total: patch?.total != null ? Number(patch.total) || 0 : prev.total,
      processed: patch?.processed != null ? Number(patch.processed) || 0 : prev.processed,
      successful: patch?.successful != null ? Number(patch.successful) || 0 : prev.successful,
      skipped: patch?.skipped != null ? Number(patch.skipped) || 0 : prev.skipped,
      failed: patch?.failed != null ? Number(patch.failed) || 0 : prev.failed,
    }));
  }, []);

  const finishLetterboxdImport = useCallback(({ successful, skipped, failed }) => {
    setStatus((prev) => ({
      ...prev,
      state: 'done',
      processed: prev.total,
      successful: Number(successful) || 0,
      skipped: Number(skipped) || 0,
      failed: Number(failed) || 0,
      finishedAt: Date.now(),
    }));
  }, []);

  const failLetterboxdImport = useCallback((message) => {
    setStatus((prev) => ({
      ...prev,
      state: 'error',
      error: message || 'Import failed',
      finishedAt: Date.now(),
    }));
  }, []);

  const dismiss = useCallback(() => {
    setStatus(initialState);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const value = useMemo(
    () => ({
      status,
      startLetterboxdImport,
      updateLetterboxdImport,
      finishLetterboxdImport,
      failLetterboxdImport,
      dismiss,
    }),
    [status, startLetterboxdImport, updateLetterboxdImport, finishLetterboxdImport, failLetterboxdImport, dismiss]
  );

  return (
    <ImportStatusContext.Provider value={value}>
      {children}
    </ImportStatusContext.Provider>
  );
}

export function useImportStatus() {
  const ctx = useContext(ImportStatusContext);
  if (!ctx) throw new Error('useImportStatus must be used inside ImportStatusProvider');
  return ctx;
}

