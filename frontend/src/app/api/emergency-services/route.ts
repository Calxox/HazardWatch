import {
  emergencyPointSchema,
  emergencyRadiusKm,
  parseEmergencyStations,
  type EmergencyPoint,
  type EmergencyStation,
} from '@/features/hazardwatch/emergency-services'

export const runtime = 'nodejs'
// shortcut: cache/throttle belongs to this process; use a dedicated Overpass instance and shared limits before public deployment.
const cache = new Map<string, { expires: number; stations: EmergencyStation[] }>()
const pending = new Map<string, Promise<EmergencyStation[]>>()
let lastRequest = 0
const reply = (body: object, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '2' } : {}) },
  })

async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<string> {
  if (!stream) throw new Error('Missing response body.')
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let text = '',
    size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) throw new Error('Body too large.')
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } catch (error) {
    await reader.cancel()
    throw error
  } finally {
    reader.releaseLock()
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host') || new URL(request.url).host
  if (origin && ![`http://${host}`, `https://${host}`].includes(origin))
    return reply({ error: 'Use station search from this website.' }, 403)
  let point: EmergencyPoint
  try {
    point = emergencyPointSchema.parse(JSON.parse(await readLimited(request.body, 512)))
  } catch {
    return reply({ error: 'Enter valid Australia/New Zealand coordinates.' }, 400)
  }
  const key = `${point.latitude},${point.longitude}`
  const existing = cache.get(key)
  if (existing && existing.expires > Date.now())
    return reply({ stations: existing.stations, radiusKm: emergencyRadiusKm })
  let search = pending.get(key)
  if (!search) {
    if (pending.size >= 1 || Date.now() - lastRequest < 1000)
      return reply({ error: 'Station lookup is busy. Wait a moment and retry.' }, 429)
    lastRequest = Date.now()
    const query = `[out:json][timeout:20][maxsize:16777216];area["ISO3166-1"~"^(AU|NZ)$"]["boundary"="administrative"]["admin_level"="2"]->.countries;(nwr(around:${emergencyRadiusKm * 1000},${point.latitude},${point.longitude})(area.countries)["amenity"~"^(fire_station|hospital)$"];nwr(around:${emergencyRadiusKm * 1000},${point.latitude},${point.longitude})(area.countries)["healthcare"="hospital"];);out body center;`
    const searchPoint = point
    search = (async () => {
      const endpoint = new URL(
        process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter'
      )
      if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Invalid lookup URL')
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'HazardWatch/1.0 (https://github.com/Calxox/HazardWatch)',
        },
        body: new URLSearchParams({ data: query }).toString(),
        cache: 'no-store',
        signal: AbortSignal.timeout(25000),
      })
      if (!response.ok) throw new Error('Station provider unavailable.', { cause: response.status })
      const stations = parseEmergencyStations(
        JSON.parse(await readLimited(response.body, 2 * 1024 * 1024)),
        searchPoint
      )
      if (cache.size >= 100) cache.delete(cache.keys().next().value!)
      cache.set(key, { stations, expires: Date.now() + 10 * 60 * 1000 })
      return stations
    })()
    pending.set(key, search)
  }
  try {
    return reply({ stations: await search, radiusKm: emergencyRadiusKm })
  } catch (error) {
    console.warn('Emergency service lookup failed.', {
      type: error instanceof Error ? error.name : 'UnknownError',
      upstreamStatus:
        error instanceof Error && typeof error.cause === 'number' ? error.cause : undefined,
    })
    return reply({ error: 'Station lookup is unavailable. Please retry later.' }, 503)
  } finally {
    if (pending.get(key) === search) pending.delete(key)
  }
}
