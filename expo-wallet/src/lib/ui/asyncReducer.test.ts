import { asyncReducer, initialAsyncState, AsyncStateShape } from './asyncReducer';

const err = { title: 'X', detail: 'y' };

describe('asyncReducer', () => {
  it('starts with no data as loading', () => {
    const s0 = initialAsyncState<number>();
    expect(s0.loading).toBe(false);
    const s1 = asyncReducer(s0, { type: 'start' });
    expect(s1).toMatchObject({ loading: true, refreshing: false, error: undefined });
  });

  it('start with existing data is a refresh, not a blanking load', () => {
    const withData: AsyncStateShape<number> = { ...initialAsyncState<number>(), data: 7 };
    const s = asyncReducer(withData, { type: 'start' });
    expect(s).toMatchObject({ loading: false, refreshing: true, data: 7 });
  });

  it('success clears everything and stores data', () => {
    const s = asyncReducer(asyncReducer(initialAsyncState<number>(), { type: 'start' }), { type: 'success', data: 42 });
    expect(s).toMatchObject({ data: 42, loading: false, refreshing: false, error: undefined, staleError: undefined });
  });

  it('failure with NO data becomes a blocking error', () => {
    const s = asyncReducer(asyncReducer(initialAsyncState<number>(), { type: 'start' }), { type: 'failure', error: err });
    expect(s).toMatchObject({ data: undefined, error: err, staleError: undefined, loading: false });
  });

  it('failure WITH data becomes staleError and keeps data', () => {
    const withData: AsyncStateShape<number> = { ...initialAsyncState<number>(), data: 7 };
    const started = asyncReducer(withData, { type: 'start' });
    const s = asyncReducer(started, { type: 'failure', error: err });
    expect(s).toMatchObject({ data: 7, staleError: err, error: undefined });
  });

  it('setData replaces data (optimistic update)', () => {
    const withData: AsyncStateShape<number> = { ...initialAsyncState<number>(), data: 1 };
    expect(asyncReducer(withData, { type: 'setData', data: 2 }).data).toBe(2);
  });
});
