import { mapError } from './mapError';

describe('mapError', () => {
  it('maps network/timeout failures', () => {
    expect(mapError(new Error('Network request failed')).title).toBe('Network problem');
    expect(mapError(new Error('fetch timeout')).title).toBe('Network problem');
  });

  it('maps 404 / not found', () => {
    expect(mapError(new Error('Navy API /x failed (HTTP 404)')).title).toBe('Not found');
  });

  it('maps 5xx / server errors', () => {
    expect(mapError(new Error('Navy API /x failed (HTTP 503)')).title).toBe('Server problem');
    expect(mapError(new Error('failed (HTTP 500)')).title).toBe('Server problem');
  });

  it('maps auth/session loss', () => {
    expect(mapError(new Error('Navy API /x failed (HTTP 401)')).title).toBe('Session expired');
  });

  it('falls back with a truncated message', () => {
    const m = mapError(new Error('something odd happened'));
    expect(m.title).toBe("Something went wrong");
    expect(m.detail).toContain('something odd');
  });

  it('handles non-Error input', () => {
    expect(mapError(undefined).title).toBe('Something went wrong');
    expect(mapError('boom').detail).toContain('boom');
  });
});
