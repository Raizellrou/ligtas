export const HUB_URL = (import.meta.env.VITE_LIGTAS_HUB_URL as string | undefined) ?? 'http://localhost:3001'

/**
 * Whether this build is meant to have a hub to talk to: always in dev, and in a
 * production build only when VITE_LIGTAS_HUB_URL was set. The hosted demo has
 * no hub, and the localhost default would make every visitor's browser poll a
 * private address (and can raise Chrome's local-network permission prompt), so
 * background polling is gated on this rather than on HUB_URL merely existing.
 */
export const HUB_CONFIGURED: boolean = import.meta.env.DEV || Boolean(import.meta.env.VITE_LIGTAS_HUB_URL)
