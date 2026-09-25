import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AlertBundle } from '@ligtas/core'
import { fetchAlertFeed, sameAlerts } from '../src/lib/alertFeed'

function bundle(source: 'live' | 'captured', packets: string[] = [], issuerKey = 'GKEY'): AlertBundle {
  return {
    schemaVersion: 1,
    generatedAt: 1,
    source,
    issuers: [{ issuerIndex: 0, issuerPublicKey: issuerKey }],
    alerts: packets.map((packetHex, i) => ({ packetHex, receivedAt: 100 + i })),
  }
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchAlertFeed', () => {
  it('uses the hub when this build has one and it answers', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes('/alerts') ? ok(bundle('live', ['aa'])) : ok(bundle('captured'))))
    vi.stubGlobal('fetch', fetchMock)

    const feed = await fetchAlertFeed(true)

    expect(feed.from).toBe('hub')
    expect(feed.bundle.source).toBe('live')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the recorded bundle when the hub is unreachable', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/alerts')) throw new TypeError('Failed to fetch')
      return ok(bundle('captured', ['bb']))
    })

    const feed = await fetchAlertFeed(true)

    expect(feed.from).toBe('static')
    expect(feed.bundle.source).toBe('captured')
  })

  it('falls back when the hub answers with an error status', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('/alerts') ? new Response('nope', { status: 500 }) : ok(bundle('captured')),
    )
    expect((await fetchAlertFeed(true)).from).toBe('static')
  })

  it('never calls the hub when this build has none configured', async () => {
    const fetchMock = vi.fn(async () => ok(bundle('captured')))
    vi.stubGlobal('fetch', fetchMock)

    const feed = await fetchAlertFeed(false)

    expect(feed.from).toBe('static')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/alert-bundle.json')
  })

  it('bypasses the service-worker precache so an offline phone cannot look freshly updated', async () => {
    const fetchMock = vi.fn(async () => ok(bundle('captured')))
    vi.stubGlobal('fetch', fetchMock)

    await fetchAlertFeed(false)

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/alert-bundle\.json\?t=\d+/)
  })

  it('throws when neither source can be reached, so the caller can use the stored copy', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(fetchAlertFeed(true)).rejects.toThrow()
  })
})

describe('sameAlerts', () => {
  it('is true for the same packets in the same order', () => {
    expect(sameAlerts(bundle('live', ['aa', 'bb']), bundle('live', ['aa', 'bb']))).toBe(true)
  })

  it('ignores generatedAt, which changes on every hub response', () => {
    const a = bundle('live', ['aa'])
    const b = { ...bundle('live', ['aa']), generatedAt: 999 }
    expect(sameAlerts(a, b)).toBe(true)
  })

  it('is false when an alert is added', () => {
    expect(sameAlerts(bundle('live', ['aa']), bundle('live', ['aa', 'bb']))).toBe(false)
  })

  it('is false when a packet differs', () => {
    expect(sameAlerts(bundle('live', ['aa']), bundle('live', ['ab']))).toBe(false)
  })

  it('is false when the issuer key changes', () => {
    expect(sameAlerts(bundle('live', ['aa'], 'GONE'), bundle('live', ['aa'], 'GTWO'))).toBe(false)
  })

  it('is false when the feed switches from the recording to the hub, even with no alerts', () => {
    expect(sameAlerts(bundle('captured'), bundle('live'))).toBe(false)
  })
})
