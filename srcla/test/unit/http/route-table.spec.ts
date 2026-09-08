process.env.LOG_LEVEL = 'silent';

import { jest } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import {
  buildServer,
  buildOperatorServer,
  startOperatorServer,
  OPERATOR_HTTP_HOST,
  PUBLIC_ALLOWED_METHODS,
  type RouteRecord,
} from '../../../src/http/server.js';

/**
 * Paper §10.2: the read API "has no mutation or transaction endpoint."
 *
 * These assertions ENUMERATE the registered route table rather than probing a
 * list of paths. A path-probing test only catches the mutations its author
 * thought of; enumeration catches a POST somebody adds in a year's time,
 * because the route it registers lands in the table whatever it is called.
 *
 * Nothing here binds a port. `buildServer`/`buildOperatorServer` construct the
 * Fastify instances and `ready()` finalises the router; `listen` is never
 * called (the one binding assertion drives a stub).
 */

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function methodsOf(table: RouteRecord[]): string[] {
  return [...new Set(table.map((r) => r.method))].sort();
}

describe('public read listener route table (§10.2)', () => {
  let server: FastifyInstance;
  let table: RouteRecord[];

  beforeAll(async () => {
    // No prisma client is constructed: the handlers are never invoked here,
    // and registerRoutes takes the client as a parameter.
    server = await buildServer({ host: '0.0.0.0', port: 0 }, {} as never);
    await server.ready();
    table = server.srclaRouteTable;
  });

  afterAll(async () => {
    await server.close();
  });

  it('registers a non-trivial number of routes', () => {
    // Anti-vacuity guard: every "no mutation" assertion below is satisfied by
    // an empty table, so first prove the table is actually populated.
    expect(table.length).toBeGreaterThan(20);
    expect(table.map((r) => r.url)).toContain('/v1/markets');
    expect(table.map((r) => r.url)).toContain('/v1/decisions');
  });

  it('registers no mutating route at all', () => {
    const mutating = table.filter((r) => MUTATING_METHODS.includes(r.method));
    // Named in the failure message so a future addition is identified, not
    // just counted.
    expect(mutating.map((r) => `${r.method} ${r.url}`)).toEqual([]);
  });

  it('registers only read methods', () => {
    // Stricter than the previous assertion: an exotic method (OPTIONS on a
    // hand-written route, TRACE, a custom verb) is caught too.
    expect(methodsOf(table).every((m) => PUBLIC_ALLOWED_METHODS.includes(m))).toBe(true);
    expect(methodsOf(table)).toEqual(['GET', 'HEAD', 'OPTIONS']);
  });

  it('no longer carries the three routes that moved to the operator listener', () => {
    const urls = table.filter((r) => r.method !== 'OPTIONS').map((r) => r.url);
    expect(urls).not.toContain('/v1/internal/trigger');
    expect(urls).not.toContain('/v1/proposals/review');
    // GET /v1/manifests stays; only the POST moved, and the previous test
    // already proves no POST is registered on this listener.
    expect(urls).toContain('/v1/manifests');
  });

  it('serves the §10.2 read routes that were missing', () => {
    const gets = table.filter((r) => r.method === 'GET').map((r) => r.url);
    expect(gets).toEqual(expect.arrayContaining(['/v1/reserve', '/v1/emergencies', '/v1/policy', '/v1/sync']));
  });

});

describe('public read listener mutation guard (§10.2)', () => {
  // A separate, not-yet-`ready()` instance: Fastify refuses any route once the
  // instance is listening/ready, which would mask the guard under a different
  // error.
  let fresh: FastifyInstance;

  beforeEach(async () => {
    fresh = await buildServer({ host: '0.0.0.0', port: 0 }, {} as never);
  });

  afterEach(async () => {
    await fresh.close();
  });

  it('refuses to register a mutating route, so the table cannot silently regrow one', () => {
    // The discriminating assertion. Enumeration alone is a snapshot of today's
    // table; this proves the invariant is ENFORCED, so a POST added next year
    // fails at boot rather than only failing this file's first assertion.
    expect(() => fresh.post('/v1/some-future-mutation', async () => ({}))).toThrow(
      /has no mutation or transaction endpoint/
    );
  });

  it('refuses methods other than POST too', () => {
    expect(() => fresh.delete('/v1/some-future-deletion', async () => ({}))).toThrow(
      /refusing to register DELETE/
    );
    expect(() => fresh.put('/v1/some-future-put', async () => ({}))).toThrow(
      /refusing to register PUT/
    );
  });

  it('still admits a new read route', () => {
    // The guard must reject mutations specifically, not every late route --
    // otherwise the tests above would pass against a hook that throws on
    // everything.
    expect(() => fresh.get('/v1/some-future-read', async () => ({}))).not.toThrow();
  });
});

describe('operator listener', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildOperatorServer({ port: 0 }, undefined, {} as never);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('carries exactly the three mutations that left the public listener', () => {
    const posts = server.srclaRouteTable
      .filter((r) => r.method === 'POST')
      .map((r) => r.url)
      .sort();
    expect(posts).toEqual(['/v1/internal/trigger', '/v1/manifests', '/v1/proposals/review']);
  });

  it('binds to loopback only', async () => {
    expect(OPERATOR_HTTP_HOST).toBe('127.0.0.1');

    const calls: Array<{ host: string; port: number }> = [];
    const listen = async (opts: { host: string; port: number }) => {
      calls.push(opts);
      return '';
    };
    const stub = { listen, log: { error: jest.fn() } } as unknown as FastifyInstance;
    await startOperatorServer(stub, { port: 3101 });

    // The host is NOT taken from the config object -- there is no env var that
    // could move it off loopback.
    expect(calls).toEqual([{ host: '127.0.0.1', port: 3101 }]);
  });
});
