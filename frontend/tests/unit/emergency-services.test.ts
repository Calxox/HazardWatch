// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  distanceKm,
  emergencyPointSchema,
  emergencyResponseSchema,
  lookupEmergencyServices,
  parseEmergencyStations,
} from '@/features/hazardwatch/emergency-services'

const point = { latitude: -37.8136, longitude: 144.9631 }
const node = (id: number, lat: number, tags: Record<string, string>, lon = point.longitude) => ({
  type: 'node',
  id,
  lat,
  lon,
  tags,
})
const payload = {
  elements: [node(1, -37.814, { amenity: 'fire_station', name: 'Test fire station' })],
}
const request = (body: unknown = point, origin = 'http://localhost:3002') =>
  new Request('http://localhost:3002/api/emergency-services', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
let provider: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetModules()
  provider = vi.fn().mockImplementation(async () => Response.json(payload))
  vi.stubGlobal('fetch', provider)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('ranks three hospitals and three fire stations independently, preserving precise node and area coordinates', () => {
  const result = parseEmergencyStations(
    {
      elements: [
        node(4, -37.88, { amenity: 'fire_station' }),
        node(7, -37.815, { amenity: 'fire_station', name: 'Second fire' }),
        node(8, -37.816, { amenity: 'fire_station', name: 'Third fire' }),
        {
          type: 'relation',
          id: 3,
          center: { lat: -37.83, lon: point.longitude },
          tags: { healthcare: 'hospital', 'name:en': 'Hospital 2' },
        },
        {
          type: 'way',
          id: 2,
          center: { lat: -37.82, lon: 144.96312345 },
          tags: {
            amenity: 'hospital',
            name: 'Hospital 1',
            'addr:housenumber': '10',
            'addr:street': 'Test Street',
            'addr:city': 'Melbourne',
          },
        },
        node(5, -37.84, { amenity: 'hospital', name: 'Hospital 3' }),
        node(6, -37.9, { amenity: 'hospital', name: 'Hospital 4' }),
        ...payload.elements,
      ],
    },
    point
  )
  expect(result.map((station) => station.id)).toEqual([
    'node/1',
    'node/7',
    'node/8',
    'way/2',
    'relation/3',
    'node/5',
  ])
  expect(result.filter((station) => station.kind === 'fire')).toHaveLength(3)
  expect(result.filter((station) => station.kind === 'hospital')).toHaveLength(3)
  expect(result[3]).toMatchObject({
    longitude: 144.96312345,
    latitude: -37.82,
    address: '10 Test Street, Melbourne',
  })
  expect(result[0]!.distanceKm).toBeCloseTo(0.04448, 4)
  expect(result[3]!.distanceKm).toBeLessThan(result[4]!.distanceKm)
})

test('drops police, ambulance, invalid, inactive, distant and duplicate features', () => {
  const result = parseEmergencyStations(
    {
      elements: [
        null,
        {},
        node(2, NaN, { amenity: 'hospital' }),
        node(3, -91, { amenity: 'hospital' }),
        node(4, -37.81, { amenity: 'hospital' }, Infinity),
        node(5, 51, { amenity: 'hospital' }, 0),
        node(6, -33, { amenity: 'hospital' }),
        node(7, -37.81, { amenity: 'police' }),
        node(8, -37.81, { amenity: 'hospital', disused: 'yes' }),
        node(9, -37.81, { amenity: 'fire_station', abandoned: 'true' }),
        node(12, -37.81, { emergency: 'ambulance_station' }),
        ...payload.elements,
        ...payload.elements,
        {
          type: 'way',
          id: 10,
          center: { lat: -37.8141, lon: point.longitude },
          tags: {
            amenity: 'fire_station',
            name: 'TEST FIRE STATION',
            phone: '+61 3 1234 5678',
            website: 'https://fire.example.org',
          },
        },
        node(11, -37.82, { healthcare: 'hospital' }),
      ],
    },
    point
  )
  expect(result.map((station) => station.id)).toEqual(['node/1', 'node/11'])
  expect(result[0]).toMatchObject({
    phone: '+61 3 1234 5678',
    website: 'https://fire.example.org/',
  })
  expect(result[1]!.name).toBe('Hospital')
})

test('handles New Zealand longitude across the antimeridian without reversing coordinates', () => {
  const origin = { latitude: -43.95, longitude: -176.5 }
  expect(emergencyPointSchema.parse(origin)).toEqual(origin)
  const result = parseEmergencyStations(
    { elements: [node(1, -43.951, { amenity: 'fire_station' }, -176.501)] },
    origin
  )
  expect(result[0]).toMatchObject({ latitude: -43.951, longitude: -176.501 })
  expect(
    distanceKm({ latitude: -43, longitude: 179.99 }, { latitude: -43, longitude: -179.99 })
  ).toBeLessThan(2)
})

test('empty results are valid but partial or malformed provider responses fail', () => {
  expect(parseEmergencyStations({ elements: [] }, point)).toEqual([])
  for (const input of [
    {},
    { elements: 'invalid' },
    { ...payload, remark: 'runtime error: Query timed out' },
  ]) {
    expect(() => parseEmergencyStations(input, point)).toThrow()
  }
})

test('route uses a fixed provider, a country-limited query and caches exact-coordinate searches', async () => {
  const { POST } = await import('@/app/api/emergency-services/route')
  const response = await POST(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ radiusKm: 100, stations: [{ id: 'node/1' }] })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const [url, init] = provider.mock.calls[0]!
  expect(url).toBe('https://overpass-api.de/api/interpreter')
  const query = new URLSearchParams(init.body).get('data')!
  expect(query).toContain('^(AU|NZ)$')
  expect(query).toContain('(around:100000,-37.8136,144.9631)(area.countries)')
  expect(query).toContain('out body center;')
  expect(query).toContain('^(fire_station|hospital)$')
  expect(query).toContain('["healthcare"="hospital"]')
  expect(query).not.toMatch(/police|ambulance_station/)
  expect(init.signal).toBeInstanceOf(AbortSignal)
  expect((await POST(request())).status).toBe(200)
  expect(provider).toHaveBeenCalledTimes(1)
})

test.each([
  { latitude: -37.8, longitude: '144.9);out;' },
  { latitude: -91, longitude: 144 },
  { latitude: -37, longitude: 181 },
  { latitude: 51, longitude: 0 },
  { latitude: 0, longitude: 0 },
  { latitude: -37, longitude: 144, query: 'other' },
  {},
  null,
])('rejects invalid or injected input without a provider call: %j', async (input) => {
  const { POST } = await import('@/app/api/emergency-services/route')
  expect((await POST(request(input))).status).toBe(400)
  expect(provider).not.toHaveBeenCalled()
})

test('rejects foreign origins, oversized bodies and invalid encoding before querying', async () => {
  const { POST } = await import('@/app/api/emergency-services/route')
  expect((await POST(request(point, 'https://foreign.test'))).status).toBe(403)
  expect((await POST(request({ ...point, padding: 'x'.repeat(600) }))).status).toBe(400)
  expect(
    (
      await POST(
        new Request('http://localhost:3002/api/emergency-services', {
          method: 'POST',
          body: new Uint8Array([0xff]),
        })
      )
    ).status
  ).toBe(400)
  expect(provider).not.toHaveBeenCalled()
})

test('coalesces concurrent searches for one point and throttles a different point', async () => {
  let resolve!: (response: Response) => void
  provider.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const { POST } = await import('@/app/api/emergency-services/route')
  const first = POST(request())
  await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1))
  const second = POST(request())
  const busy = await POST(request({ ...point, latitude: -37.82 }))
  expect(busy.status).toBe(429)
  expect(busy.headers.get('Retry-After')).toBe('2')
  resolve(Response.json(payload))
  expect((await first).status).toBe(200)
  expect((await second).status).toBe(200)
  expect(provider).toHaveBeenCalledTimes(1)
})

test.each(['http', 'partial', 'invalid', 'large', 'timeout'])(
  'provider %s failure returns a controlled unavailable response',
  async (mode) => {
    provider.mockImplementation(async () => {
      if (mode === 'timeout') throw new DOMException('expired', 'TimeoutError')
      if (mode === 'http') return new Response('down', { status: 504 })
      if (mode === 'partial') return Response.json({ ...payload, remark: 'partial results' })
      if (mode === 'large') return new Response('x'.repeat(2 * 1024 * 1024 + 1))
      return Response.json({ elements: null })
    })
    const { POST } = await import('@/app/api/emergency-services/route')
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Station lookup is unavailable. Please retry later.',
    })
  }
)

test('expired cached data is fetched again', async () => {
  vi.useFakeTimers()
  const { POST } = await import('@/app/api/emergency-services/route')
  expect((await POST(request())).status).toBe(200)
  vi.advanceTimersByTime(10 * 60 * 1000 + 1)
  expect((await POST(request())).status).toBe(200)
  expect(provider).toHaveBeenCalledTimes(2)
})

test('client validates data, exact query coordinates, HTTP errors and cancellation', async () => {
  const stations = parseEmergencyStations(payload, point)
  provider.mockResolvedValueOnce(Response.json({ stations, radiusKm: 100 }))
  const controller = new AbortController()
  expect(await lookupEmergencyServices(point, controller.signal)).toEqual(stations)
  expect(provider.mock.calls[0]![0]).toBe('/api/emergency-services')
  expect(JSON.parse(provider.mock.calls[0]![1].body)).toEqual(point)
  const signal = provider.mock.calls[0]![1].signal as AbortSignal
  controller.abort()
  expect(signal.aborted).toBe(true)
  provider.mockResolvedValueOnce(Response.json({ stations: [{ latitude: 91 }], radiusKm: 100 }))
  await expect(lookupEmergencyServices(point, new AbortController().signal)).rejects.toThrow(
    'invalid data'
  )
  provider.mockResolvedValueOnce(new Response('', { status: 429 }))
  await expect(lookupEmergencyServices(point, new AbortController().signal)).rejects.toThrow('busy')
})

test('extracts published contact tags and labels hospital emergency department availability without assuming it', () => {
  const result = parseEmergencyStations(
    {
      elements: [
        node(1, -37.8137, {
          amenity: 'hospital',
          name: 'General Hospital',
          emergency: 'yes',
          phone: '+61 3 1234 5678; (03) 9123 4567',
          website: 'https://hospital.example.org/contact',
        }),
        node(2, -37.8138, {
          healthcare: 'hospital',
          name: 'Private Hospital',
          emergency: 'no',
          'contact:phone': '+64 4 123 4567',
          'contact:website': 'www.private.example.org',
        }),
        node(3, -37.8139, { amenity: 'hospital', name: 'Unknown Hospital' }),
        node(4, -37.814, { amenity: 'fire_station', name: 'Fire Station', emergency: 'yes' }),
      ],
    },
    point
  )
  expect(result[0]).toMatchObject({
    phone: '+61 3 1234 5678; (03) 9123 4567',
    website: 'https://hospital.example.org/contact',
    emergencyDepartment: 'yes',
  })
  expect(result[1]).toMatchObject({
    phone: '+64 4 123 4567',
    website: 'https://www.private.example.org/',
    emergencyDepartment: 'no',
  })
  expect(result[2]).toMatchObject({ phone: '', website: '', emergencyDepartment: 'unknown' })
  expect(result[3]!.emergencyDepartment).toBe('unknown')
})

test.each([
  'javascript:alert(1)',
  'data:text/html,<script>x</script>',
  'ftp://unsafe.example.org',
  'https://user:password@unsafe.example.org',
  'https://safe.example.org/\\nunsafe',
  '//unsafe.example.org',
  '/relative',
])('discards unsafe website %s while retaining the valid facility', (website) => {
  const result = parseEmergencyStations(
    { elements: [node(1, -37.814, { amenity: 'hospital', website, phone: '+61 3 1234 5678' })] },
    point
  )
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ website: '', phone: '+61 3 1234 5678' })
})

test('unsafe contact values are removed at the client response boundary and valid alternatives survive', () => {
  const station = parseEmergencyStations(payload, point)[0]!
  const checked = emergencyResponseSchema.parse({
    radiusKm: 100,
    stations: [
      {
        ...station,
        phone: 'javascript:alert(1); +61 3 1234 5678',
        website: 'https://user:password@unsafe.example.org',
      },
    ],
  })
  expect(checked.stations[0]).toMatchObject({ phone: '+61 3 1234 5678', website: '' })
  const result = parseEmergencyStations(
    {
      elements: [
        node(1, -37.814, {
          amenity: 'hospital',
          phone: 'javascript:alert(1)',
          'contact:phone': '+64 4 123 4567',
          website: 'javascript:alert(1)',
          'contact:website': 'https://valid.example.org',
        }),
      ],
    },
    point
  )
  expect(result[0]).toMatchObject({
    phone: '+64 4 123 4567',
    website: 'https://valid.example.org/',
  })
  expect(
    emergencyResponseSchema.safeParse({
      radiusKm: 100,
      stations: Array.from({ length: 4 }, (_, id) => ({ ...station, id: `node/${id + 1}` })),
    }).success
  ).toBe(false)
  expect(
    emergencyResponseSchema.safeParse({ radiusKm: 100, stations: [{ ...station, kind: 'police' }] })
      .success
  ).toBe(false)
})
