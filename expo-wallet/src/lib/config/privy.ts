/**
 * The passkey relying-party id — the app's associated domain, configured in the
 * Privy dashboard + iOS `app.json` associatedDomains. Shared by passkey LOGIN
 * (login screen) and passkey LINK (settings) so they stay in sync. Update this
 * one place when the real associated domain is provisioned.
 */
export const RELYING_PARTY = 'navy.app';
