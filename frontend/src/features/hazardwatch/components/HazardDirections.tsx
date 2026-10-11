import { ExternalLink } from 'lucide-react'
import { coordinateSchema } from '@/features/hazardwatch/location'
import type { Incident } from '@/features/hazardwatch/model'

export function HazardDirections({ incident }: { incident: Incident }) {
  const point = coordinateSchema.safeParse({
    latitude: incident.lat,
    longitude: incident.lng,
    source: 'coordinates',
  })
  if (!point.success) return null

  return (
    <section className="hw-directions" aria-label="Location and directions">
      <h3>Directions from your location</h3>
      <p className="hw-note">
        Destination: {point.data.latitude.toFixed(6)}, {point.data.longitude.toFixed(6)}
      </p>
      <MapDirectionLinks latitude={point.data.latitude} longitude={point.data.longitude} />
      <p className="hw-note">
        Opens your chosen maps service with these destination coordinates. Maps uses your current
        location or asks for a starting point. Routes are not verified for hazard safety.
      </p>
    </section>
  )
}

export function MapDirectionLinks({
  latitude,
  longitude,
}: {
  latitude: number
  longitude: number
}) {
  const point = coordinateSchema.safeParse({ latitude, longitude, source: 'coordinates' })
  if (!point.success) return null
  const destination = `${point.data.latitude},${point.data.longitude}`
  const google = new URLSearchParams({ api: '1', destination, travelmode: 'driving' })
  const apple = new URLSearchParams({ destination, mode: 'driving' })

  return (
    <div className="hw-inline-actions">
      <a
        className="hw-button hw-secondary"
        href={`https://www.google.com/maps/dir/?${google}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Directions in Google Maps (opens in a new tab)"
      >
        Google Maps <ExternalLink size={14} aria-hidden="true" />
      </a>
      <a
        className="hw-button hw-secondary"
        href={`https://maps.apple.com/directions?${apple}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Directions in Apple Maps (opens in a new tab)"
      >
        Apple Maps <ExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
  )
}
