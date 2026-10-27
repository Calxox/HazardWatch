import { afterEach, expect, test, vi } from 'vitest'
import { readMediaLocation } from '@/features/hazardwatch/api'

afterEach(() => vi.unstubAllGlobals())

test.each([
  ['image/jpeg', 'exif', -33.71312345, 150.31123456],
  ['video/quicktime', 'quicktime', -43.95312345, -176.51234567],
  ['image/jpeg', 'exif', 0, 0],
] as const)(
  'valid %s GPS retains canonical coordinates and an explicit source',
  async (type, source, latitude, longitude) => {
    const file = new File(['media'], 'evidence', { type })
    const result = { status: 'found', latitude, longitude, source, detail: 'GPS found.' }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => result })
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    expect(await readMediaLocation(file, signal)).toEqual(result)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toMatch(/\/v1\/media\/location$/)
    expect(init).toMatchObject({ method: 'POST', signal })
    expect((init.body as FormData).get('file')).toBe(file)
  }
)

test.each(['missing', 'invalid', 'unsupported'] as const)(
  'metadata status %s leaves coordinates unavailable',
  async (status) => {
    const result = {
      status,
      latitude: null,
      longitude: null,
      source: null,
      detail: 'No usable GPS.',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => result }))
    expect(
      await readMediaLocation(new File(['media'], 'evidence.jpg'), new AbortController().signal)
    ).toEqual(result)
  }
)

test.each([
  { latitude: null },
  { longitude: null },
  { source: null },
  { latitude: 91 },
  { longitude: -181 },
  { latitude: Infinity },
])('found metadata with unusable fields is rejected: %j', async (invalid) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'found',
        latitude: -33.713,
        longitude: 150.311,
        source: 'exif',
        detail: 'GPS found.',
        ...invalid,
      }),
    })
  )
  await expect(
    readMediaLocation(new File(['media'], 'evidence.jpg'), new AbortController().signal)
  ).rejects.toThrow('Invalid coordinates in media metadata. Enter a location manually.')
})

test('malformed payloads and unreadable responses reject without yielding a location', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'found', latitude: 'bad' }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('Bad JSON')
      },
    })
    .mockResolvedValueOnce({ ok: false })
  vi.stubGlobal('fetch', fetchMock)
  const file = new File(['media'], 'evidence.jpg')
  const signal = new AbortController().signal
  await expect(readMediaLocation(file, signal)).rejects.toThrow(
    'Invalid location metadata. Enter a location manually.'
  )
  await expect(readMediaLocation(file, signal)).rejects.toThrow(SyntaxError)
  await expect(readMediaLocation(file, signal)).rejects.toThrow(
    'Location metadata could not be read.'
  )
})
