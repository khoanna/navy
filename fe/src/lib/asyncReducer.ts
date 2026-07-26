import type { MappedError } from './mapError';

export interface AsyncStateShape<T> {
  data: T | undefined;
  loading: boolean;      // first load, no data yet
  refreshing: boolean;   // re-fetch while data is present
  error: MappedError | undefined;      // blocking: no data to show
  staleError: MappedError | undefined; // non-blocking: refresh failed, data present
}

export type AsyncAction<T> =
  | { type: 'start' }
  | { type: 'success'; data: T }
  | { type: 'failure'; error: MappedError }
  | { type: 'setData'; data: T | undefined };

export function initialAsyncState<T>(): AsyncStateShape<T> {
  return { data: undefined, loading: false, refreshing: false, error: undefined, staleError: undefined };
}

export function asyncReducer<T>(state: AsyncStateShape<T>, action: AsyncAction<T>): AsyncStateShape<T> {
  switch (action.type) {
    case 'start': {
      const hasData = state.data !== undefined;
      return { ...state, loading: !hasData, refreshing: hasData, error: undefined, staleError: undefined };
    }
    case 'success':
      return { data: action.data, loading: false, refreshing: false, error: undefined, staleError: undefined };
    case 'failure': {
      const hasData = state.data !== undefined;
      return hasData
        ? { ...state, loading: false, refreshing: false, staleError: action.error, error: undefined }
        : { ...state, loading: false, refreshing: false, error: action.error, staleError: undefined };
    }
    case 'setData':
      return { ...state, data: action.data };
    default:
      return state;
  }
}
