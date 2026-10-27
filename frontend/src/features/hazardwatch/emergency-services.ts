import { z } from 'zod'
import { coordinateSchema, inMapCoverage } from '@/features/hazardwatch/location'

export const emergencyRadiusKm = 100
export const stationLabels = {
  fire: 'Fire station',
  hospital: 'Hospital',
} as const
export const emergencyPointSchema = coordinateSchema
  .pick({ latitude: true, longitude: true })
  .strict()
  .refine(
    (point) => inMapCoverage({ ...point, source: 'coordinates' }),
    'Use coordinates within Australia or New Zealand.'
  )
export type EmergencyPoint = z.infer<typeof emergencyPointSchema>
function publishedPhone(value: string): string {
  const phone = value.trim()
  const digits = phone.replace(/\D/g, '')
  return /^\+?[\d() .-]{6,40}$/.test(phone) && digits.length >= 6 && digits.length <= 15
    ? phone
    : ''
}

function publishedPhones(value: string): string {
  if (value.length > 200) return ''
  return [...new Set(value.split(';').map(publishedPhone).filter(Boolean))].slice(0, 3).join('; ')
}

function publishedWebsite(value: string): string {
  const website = value.trim()
  if (
    !website ||
    website.length > 2048 ||
    website.startsWith('/') ||
    /[\u0000-\u0020\u007f\\]/.test(website)
  )
    return ''
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(website) ? website : `https://${website}`)
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.hostname.includes('.')
      ? url.href
      : ''
  } catch {
    return ''
  }
}

const stationSchema = z.object({
  id: z.string().regex(/^(node|way|relation)\/\d+$/),
  name: z.string().min(1).max(160),
  kind: z.enum(['fire', 'hospital']),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  distanceKm: z.number().finite().nonnegative().max(emergencyRadiusKm),
  address: z.string().max(500),
  phone: z.string().transform(publishedPhones),
  website: z.string().transform(publishedWebsite),
  emergencyDepartment: z.enum(['yes', 'no', 'unknown']),
})
export type EmergencyStation = z.infer<typeof stationSchema>
export const emergencyResponseSchema = z.object({
  stations: z
    .array(stationSchema)
    .max(6)
    .refine(
      (stations) =>
        ['fire', 'hospital'].every(
          (kind) => stations.filter((station) => station.kind === kind).length <= 3
        ),
      'Return at most three facilities of each type.'
    ),
  radiusKm: z.literal(emergencyRadiusKm),
})

export function distanceKm(a: EmergencyPoint, b: EmergencyPoint): number {
  const radians = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * radians
  const dLng = (b.longitude - a.longitude) * radians
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))))
}

const elementSchema = z.object({
  type: z.enum(['node', 'way', 'relation']),
  id: z.number().int().positive().safe(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string()).default({}),
})

export function parseEmergencyStations(
  payload: unknown,
  point: EmergencyPoint
): EmergencyStation[] {
  const response = z
    .object({ elements: z.array(z.unknown()).max(20000), remark: z.string().optional() })
    .parse(payload)
  if (response.remark) throw new Error('Incomplete station data.')
  const stations: EmergencyStation[] = []
  for (const raw of response.elements) {
    const parsed = elementSchema.safeParse(raw)
    if (!parsed.success) continue
    const element = parsed.data
    const tags = element.tags
    if (['yes', 'true', '1'].some((value) => tags.disused === value || tags.abandoned === value))
      continue
    const kind =
      tags.amenity === 'fire_station'
        ? 'fire'
        : tags.amenity === 'hospital' || tags.healthcare === 'hospital'
          ? 'hospital'
          : null
    if (!kind) continue
    const coordinates = emergencyPointSchema.safeParse({
      latitude: element.lat ?? element.center?.lat,
      longitude: element.lon ?? element.center?.lon,
    })
    if (!coordinates.success) continue
    const distance = distanceKm(point, coordinates.data)
    if (distance > emergencyRadiusKm) continue
    const name = (tags.name?.trim() || tags['name:en']?.trim() || stationLabels[kind]).slice(0, 160)
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
    const address = [
      street,
      tags['addr:suburb'],
      tags['addr:city'] || tags['addr:town'],
      tags['addr:state'],
      tags['addr:postcode'],
    ]
      .filter(Boolean)
      .join(', ')
      .slice(0, 500)
    stations.push({
      id: `${element.type}/${element.id}`,
      name,
      kind,
      ...coordinates.data,
      distanceKm: distance,
      address,
      phone: publishedPhones([tags.phone, tags['contact:phone']].filter(Boolean).join(';')),
      website:
        [tags.website, tags['contact:website']]
          .map((value) => publishedWebsite(value || ''))
          .find(Boolean) || '',
      emergencyDepartment:
        kind === 'hospital' && ['yes', 'no'].includes(tags.emergency || '')
          ? (tags.emergency as 'yes' | 'no')
          : 'unknown',
    })
  }
  const sorted = stations.sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id))
  const nearest: EmergencyStation[] = []
  for (const station of sorted) {
    const duplicate = nearest.find(
      (other) =>
        other.id === station.id ||
        (other.kind === station.kind &&
          other.name.toLowerCase() === station.name.toLowerCase() &&
          distanceKm(other, station) < 0.15)
    )
    if (duplicate) {
      duplicate.phone ||= station.phone
      duplicate.website ||= station.website
      duplicate.address ||= station.address
      if (duplicate.emergencyDepartment === 'unknown')
        duplicate.emergencyDepartment = station.emergencyDepartment
      continue
    }
    if (nearest.filter((other) => other.kind === station.kind).length === 3) continue
    nearest.push(station)
  }
  return nearest
}

export async function lookupEmergencyServices(
  point: EmergencyPoint,
  signal: AbortSignal
): Promise<EmergencyStation[]> {
  const response = await fetch('/api/emergency-services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(emergencyPointSchema.parse(point)),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
  })
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? 'Station lookup is busy. Wait a moment and retry.'
        : 'Station lookup is unavailable. Please retry later.'
    )
  }
  const result = emergencyResponseSchema.safeParse(await response.json())
  if (!result.success) throw new Error('Station lookup returned invalid data. Please retry later.')
  return result.data.stations
}
