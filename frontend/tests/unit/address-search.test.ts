import { afterEach, expect, test, vi } from 'vitest'
import {
  coordinateSchema,
  parseAddressResults,
  searchAddresses,
  suggestPlaces,
} from '@/features/hazardwatch/location'

afterEach(() => vi.unstubAllGlobals())

test('numbered address lookup preserves street labels and rejects suburb centres, wrong numbers, streets and invalid coordinates', () => {
  const house = {
    geometry: { type: 'Point', coordinates: [144.96, -37.81] },
    properties: {
      housenumber: '257',
      street: 'Test Road',
      district: 'Glenroy',
      state: 'Victoria',
      countrycode: 'AU',
    },
  }
  const result = parseAddressResults('257 test rd Glenroy', {
    features: [
      house,
      house,
      { ...house, properties: { ...house.properties, housenumber: undefined } },
      { ...house, properties: { ...house.properties, housenumber: '257A' } },
      { ...house, properties: { ...house.properties, housenumber: '258' } },
      { ...house, properties: { ...house.properties, street: 'Other Road' } },
      { ...house, geometry: { type: 'Point', coordinates: [-37.81, 144.96] } },
      { ...house, properties: { ...house.properties, countrycode: 'US' } },
    ],
  })
  expect(result).toEqual([
    {
      label: '257 Test Road, Glenroy, Victoria, Australia',
      coordinates: {
        latitude: -37.81,
        longitude: 144.96,
        source: 'address',
        countryCode: 'AU',
        region: 'Victoria',
      },
    },
  ])
  expect(parseAddressResults('257, Test Road', { features: [house] })[0]?.label).toMatch(
    /^257 Test Road/
  )
  expect(parseAddressResults('257', { features: [house] })).toEqual([])
  expect(parseAddressResults('2/257 Test Road', { features: [house] })[0]?.label).toMatch(
    /^2\/257 Test Road/
  )
  expect(parseAddressResults('257A Test Road', { features: [house] })).toEqual([])
  expect(
    parseAddressResults('257 Test Road', {
      features: [
        { ...house, properties: { ...house.properties, city: '<script>alert(1)</script>' } },
      ],
    })[0]?.label
  ).toContain('<script>')
  expect(() => parseAddressResults('257 Test Road', {})).toThrow(/invalid response/)
})

test('address requests use a cancellable same-origin POST and expose service failures without fabricated matches', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Lookup unavailable.' }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { label: 'Glenroy', coordinates: { latitude: -37.8, longitude: 145, source: 'place' } },
        ],
      }),
    })
  vi.stubGlobal('fetch', fetchMock)
  const controller = new AbortController()
  expect(await searchAddresses('257 Test Road', controller.signal)).toEqual([])
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/geocode',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ query: '257 Test Road' }),
      signal: controller.signal,
    })
  )
  await expect(searchAddresses('257 Test Road')).rejects.toThrow('Lookup unavailable.')
  await expect(searchAddresses('257 Test Road')).rejects.toThrow()
})

test('lookup rejects cross-site and oversized requests while accepting the browser host behind the Next internal URL', async () => {
  const { POST } = await import('@/app/api/geocode/route')
  const request = (body: string, origin = 'http://127.0.0.1:3001') =>
    new Request('http://localhost:3001/api/geocode', {
      method: 'POST',
      headers: { host: '127.0.0.1:3001', origin },
      body,
    })
  expect((await POST(request('{"query":"x"}'))).status).toBe(400)
  expect((await POST(request('{"query":"x"}', 'https://unrelated.example'))).status).toBe(403)
  expect((await POST(request('x'.repeat(2049)))).status).toBe(413)
})

test('place suggestions retain known country and canonical region without guessing missing divisions', async () => {
  const melbourne = (await suggestPlaces('Melbourne')).find((place) =>
    /^Melbourne,/.test(place.label)
  )
  expect(melbourne?.label).toContain('State of Victoria')
  expect(melbourne?.coordinates).toMatchObject({ countryCode: 'AU', region: 'Victoria' })
  const wellington = (await suggestPlaces('Wellington')).find((place) =>
    /^Wellington,/.test(place.label)
  )
  expect(wellington?.coordinates).toMatchObject({ countryCode: 'NZ', region: 'Wellington' })
  const country = (await suggestPlaces('New Zealand')).find(
    (place) => place.label === 'New Zealand, , New Zealand'
  )
  expect(country?.coordinates.countryCode).toBe('NZ')
  expect(country?.coordinates.region).toBeUndefined()
})

test('address metadata normalizes the known state prefix and leaves missing regions unspecified', () => {
  const address = (state: string | undefined, countrycode = 'AU') => ({
    geometry: {
      type: 'Point',
      coordinates: countrycode === 'NZ' ? [174.77, -41.28] : [144.96, -37.81],
    },
    properties: { housenumber: '257', street: 'Test Road', state, countrycode },
  })
  const result = parseAddressResults('257 Test Road', {
    features: [address('State of Victoria')],
  })[0]!
  expect(result.label).toBe('257 Test Road, State of Victoria, Australia')
  expect(result.coordinates.region).toBe('Victoria')
  expect(
    parseAddressResults('257 Test Road', { features: [address('Wellington', 'NZ')] })[0]
      ?.coordinates
  ).toMatchObject({ countryCode: 'NZ', region: 'Wellington' })
  for (const state of [undefined, '', '   ']) {
    const point = parseAddressResults('257 Test Road', { features: [address(state)] })[0]
      ?.coordinates
    expect(point?.countryCode).toBe('AU')
    expect(point?.region).toBeUndefined()
  }
})

test('address response validation preserves optional metadata and still supports coordinate-only inputs', async () => {
  const coordinates = {
    latitude: -37.81,
    longitude: 144.96,
    source: 'address',
    countryCode: 'AU',
    region: 'Victoria',
  }
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ label: '257 Test Road, Victoria, Australia', coordinates }],
      }),
    })
  )
  expect((await searchAddresses('257 Test Road'))[0]?.coordinates).toEqual(coordinates)
  expect(
    coordinateSchema.safeParse({ latitude: -37.81, longitude: 144.96, source: 'device' }).success
  ).toBe(true)
  expect(coordinateSchema.safeParse({ ...coordinates, countryCode: 'US' }).success).toBe(false)
  expect(coordinateSchema.safeParse({ ...coordinates, region: ' ' }).success).toBe(false)
})
