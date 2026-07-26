import { mapError } from './mapError';
import { NavyApiError } from './navyApi';

describe('mapError', () => {
  it('prefers the backend detail when present', () => {
    const e = new NavyApiError('Navy API /x failed (HTTP 400)', 400, 'businessName should not be empty');
    expect(mapError(e).detail).toBe('businessName should not be empty');
  });

  it('maps 401 to a session message', () => {
    expect(mapError(new NavyApiError('x', 401)).title).toBe('Session expired');
  });

  it('maps 5xx to a server message', () => {
    expect(mapError(new NavyApiError('x', 503)).title).toBe('Server problem');
  });

  it('maps generic network errors', () => {
    expect(mapError(new TypeError('Failed to fetch')).title).toBe('Network problem');
  });

  it('falls back for unknown input', () => {
    expect(mapError(undefined).title).toBe('Something went wrong');
  });
});
