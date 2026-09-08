/**
 * The two halves of a market's configuration digest, and why they must not be
 * the same string.
 *
 * §6.2 asks for two different things from a venue's configuration, and an
 * earlier revision of the archive decoder answered both with one value:
 *
 *   IDENTITY  — the protocol and the market contract (Comet, Pool, mToken).
 *               A change here means "the market's implementation changed
 *               under us", which §12 says should quarantine the market.
 *               `admit`'s CONFIG_DIGEST_MISMATCH.
 *
 *               §6.2 also lists the rate strategy among the identity pins,
 *               and this deliberately does NOT follow it, because for two of
 *               the three venues the model contract IS the parameters:
 *               Moonwell's JumpRateModel is immutable, so re-parameterising
 *               means deploying a new one, and the registered window holds
 *               ten Moonwell model addresses against ten parameter sets.
 *               Pinning it as identity would fire the implementation-swap
 *               alarm on every routine rate change. The model address lives
 *               in the parameter half instead, where a change correctly
 *               starts a new regime.
 *
 *   REGIME    — identity PLUS the material parameters in force. A change here
 *               starts a new regime and resets the minimum-history
 *               requirement, because history from a differently-parameterised
 *               market does not describe the current one. `admit`'s
 *               REGIME_MIN_HISTORY.
 *
 * Conflating them is not a stylistic problem, it is fatal to a long run.
 * Governance re-parameterises these markets routinely: over the registered
 * window Compound's supply slope moved from 52035616433440800 to
 * 54036986297479200 with the same Comet and the same rate model, and
 * Moonwell's likewise. With one shared string, the artifact pins whatever was
 * in force on day one and EVERY venue becomes permanently inadmissible at the
 * first rate change — which is exactly what the first end-to-end run showed:
 * every policy realised 0.000% because `admit` returned an empty eligible set
 * at every origin.
 *
 * The stored digest is therefore `identity|parameters`, and this module owns
 * that format so no call site has to know it.
 *
 * A PIN MAY LIST SEVERAL IDENTITIES, comma-separated. Registering the set
 * observed during calibration is the honest analogue of an operator pinning
 * what was deployed: a market contract that appears in the held-out era
 * without having appeared in calibration is still caught, and is a reportable
 * finding rather than a defect.
 *
 * PURE: no I/O, no clock, no randomness.
 */

/** Separates the identity half from the parameter half. */
export const DIGEST_SEPARATOR = '|';
/** Separates the accepted identities inside one pin. */
export const PIN_SEPARATOR = ',';

/**
 * The identity half of a stored digest.
 *
 * A digest with no separator is returned whole: a legacy or hand-written
 * digest is treated as pure identity, which is the conservative reading (it
 * makes the pin stricter, never looser).
 */
export function identityOf(configDigest: string): string {
  const i = configDigest.indexOf(DIGEST_SEPARATOR);
  return i < 0 ? configDigest : configDigest.slice(0, i);
}

/**
 * The full regime key: identity plus parameters, i.e. the stored digest.
 *
 * Present as a named function so a call site says which of the two it means
 * rather than passing the raw string and leaving the reader to guess.
 */
export function regimeOf(configDigest: string): string {
  return configDigest;
}

/** Build a pin from every identity observed during calibration. */
export function buildIdentityPin(configDigests: Iterable<string>): string {
  const identities = [...new Set([...configDigests].map(identityOf))].sort();
  return identities.join(PIN_SEPARATOR);
}

/**
 * Whether a live digest's identity is one this pin registered.
 *
 * Membership, not equality: see the multi-identity note above.
 */
export function identityMatchesPin(pin: string, configDigest: string): boolean {
  const identity = identityOf(configDigest);
  return pin.split(PIN_SEPARATOR).some((p) => p.trim() === identity);
}
