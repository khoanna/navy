'use client';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { asyncReducer, initialAsyncState, AsyncStateShape } from './asyncReducer';
import { mapError } from './mapError';

export interface UseAsyncResult<T> extends AsyncStateShape<T> {
  retry: () => void;
  setData: (updater: (prev: T | undefined) => T | undefined) => void;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  opts: { poll?: number; deps?: unknown[] } = {},
): UseAsyncResult<T> {
  const { poll, deps = [] } = opts;
  const [state, dispatch] = useReducer(asyncReducer as typeof asyncReducer<T>, undefined, initialAsyncState<T>);
  const reqId = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const id = ++reqId.current;
    dispatch({ type: 'start' });
    try {
      const data = await fnRef.current();
      if (id === reqId.current) dispatch({ type: 'success', data });
    } catch (e) {
      if (id === reqId.current) dispatch({ type: 'failure', error: mapError(e) });
    }
  }, []);

  // Initial load + reload when deps change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, deps);

  // Optional polling.
  useEffect(() => {
    if (!poll) return;
    const t = setInterval(() => { void run(); }, poll);
    return () => clearInterval(t);
  }, [poll, run]);

  // Invalidate any in-flight request on unmount so it can't set state.
  useEffect(() => () => { reqId.current++; }, []);

  const stateRef = useRef(state);
  stateRef.current = state;
  const setData = useCallback((updater: (prev: T | undefined) => T | undefined) => {
    dispatch({ type: 'setData', data: updater(stateRef.current.data) });
  }, []);

  return { ...state, retry: run, setData };
}
