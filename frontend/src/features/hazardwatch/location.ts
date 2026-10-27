import { z } from 'zod'

export const coordinateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  source: z.enum(['exif', 'quicktime', 'coordinates', 'device', 'place', 'address']),
  accuracy: z.number().finite().nonnegative().optional(),
  countryCode: z.enum(['AU', 'NZ']).optional(),
  region: z.string().trim().min(1).max(240).optional(),
})
export type Coordinates = z.infer<typeof coordinateSchema>
export const locationSources: Record<Coordinates['source'], string> = {
  exif: 'Image GPS metadata',
  quicktime: 'Video location metadata',
  coordinates: 'Entered coordinates',
  device: 'Current device location',
  place: 'Selected place (approximate centre)',
  address: 'Selected address (mapped point)',
}

export function inMapCoverage(point: Coordinates): boolean {
  const longitude = point.longitude <= -170 ? point.longitude + 360 : point.longitude
  return point.latitude >= -50 && point.latitude <= -8 && longitude >= 110 && longitude <= 190
}

export function coordinatesFromText(latitude: string, longitude: string): Coordinates | undefined {
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(latitude.trim()) ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(longitude.trim())
  )
    return undefined
  const result = coordinateSchema.safeParse({
    latitude: Number(latitude),
    longitude: Number(longitude),
    source: 'coordinates',
  })
  return result.success ? result.data : undefined
}

export function captureTimeNow(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date())
    .replace(' ', 'T')
}

function normaliseRegion(value?: string): string | undefined {
  return value?.trim().replace(/^State of\s+/i, '') || undefined
}

export interface PlaceSuggestion {
  label: string
  coordinates: Coordinates
}
export async function suggestPlaces(query: string): Promise<PlaceSuggestion[]> {
  // Reuse the map's local gazetteer; this is place search, not street-address geocoding.
  const mapModule = await import('@prototype/map.js')
  const map = mapModule.default as unknown as {
    searchPlaces: (
      value: string
    ) => { place: [string, string, 'AU' | 'NZ', number, number, number] }[]
  }
  return map.searchPlaces(query).map(({ place }) => ({
    label: `${place[0]}, ${place[1]}, ${place[2] === 'AU' ? 'Australia' : 'New Zealand'}`,
    coordinates: {
      latitude: place[3],
      longitude: place[4] > 180 ? place[4] - 360 : place[4],
      source: 'place',
      countryCode: place[2],
      region: normaliseRegion(place[1]),
    },
  }))
}

const addressSuggestionSchema = z.object({
  label: z.string().min(1).max(240),
  coordinates: coordinateSchema.extend({ source: z.literal('address') }),
})
const photonFeatureSchema = z.object({
  geometry: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    housenumber: z.string().min(1).max(80),
    street: z.string().min(1).max(240),
    district: z.string().max(240).optional(),
    city: z.string().max(240).optional(),
    state: z.string().max(240).optional(),
    postcode: z.string().max(40).optional(),
    countrycode: z.enum(['AU', 'NZ']),
  }),
})

function normaliseStreet(value: string): string {
  const types: Record<string, string> = {
    rd: 'road',
    st: 'street',
    ave: 'avenue',
    av: 'avenue',
    dr: 'drive',
    ct: 'court',
    cres: 'crescent',
    hwy: 'highway',
    pde: 'parade',
    pl: 'place',
    ln: 'lane',
    tce: 'terrace',
  }
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => types[word] || word)
    .join(' ')
}

/** Reject suburb centres, wrong numbers/streets and invalid provider coordinates. */
export function parseAddressResults(query: string, body: unknown): PlaceSuggestion[] {
  const parsed = z.object({ features: z.array(z.unknown()).max(50) }).safeParse(body)
  if (!parsed.success) throw new Error('Address lookup returned an invalid response.')
  const numbered = query.trim().match(/^(?:\d+[a-z]?\/)?(\d+[a-z]?(?:-\d+[a-z]?)?)\b[\s,]*(.*)$/i)
  const seen = new Set<string>()
  return parsed.data.features
    .flatMap((feature) => {
      const result = photonFeatureSchema.safeParse(feature)
      if (!result.success) return []
      const { properties: p, geometry } = result.data
      if (
        numbered &&
        (p.housenumber.toLowerCase() !== numbered[1]!.toLowerCase() ||
          !` ${normaliseStreet(numbered[2]!)} `.includes(` ${normaliseStreet(p.street)} `))
      )
        return []
      const point = coordinateSchema.safeParse({
        longitude: geometry.coordinates[0],
        latitude: geometry.coordinates[1],
        source: 'address',
        countryCode: p.countrycode,
        region: normaliseRegion(p.state),
      })
      if (!point.success || !inMapCoverage(point.data)) return []
      // A unit query resolves the building's mapped point; do not claim unit-level positioning.
      const unit = query.trim().match(/^(\d+[a-z]?\/)/i)?.[1] || ''
      const label = [
        ...new Set(
          [
            `${unit}${p.housenumber} ${p.street}`,
            p.district,
            p.city,
            p.state,
            p.postcode,
            p.countrycode === 'AU' ? 'Australia' : 'New Zealand',
          ].filter(Boolean)
        ),
      ].join(', ')
      if (label.length > 240 || seen.has(label)) return []
      seen.add(label)
      return [{ label, coordinates: point.data }]
    })
    .slice(0, 8)
}

export async function searchAddresses(
  query: string,
  signal?: AbortSignal
): Promise<PlaceSuggestion[]> {
  const response = await fetch('/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body)
    throw new Error(error.success ? error.data.error : 'Address lookup is unavailable.')
  }
  return z.object({ results: z.array(addressSuggestionSchema).max(8) }).parse(body).results
}
