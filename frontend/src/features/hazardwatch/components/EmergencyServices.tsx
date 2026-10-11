'use client'

import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import type { Coordinates } from '@/features/hazardwatch/location'
import {
  emergencyPointSchema,
  emergencyRadiusKm,
  lookupEmergencyServices,
  type EmergencyPoint,
  type EmergencyStation,
} from '@/features/hazardwatch/emergency-services'
import { MapDirectionLinks } from './HazardDirections'
import { LocationInput } from './LocationInput'

export function NearbyEmergencyServices({
  latitude,
  longitude,
  onStations,
}: EmergencyPoint & { onStations?: (stations: EmergencyStation[]) => void }) {
  const key = `${latitude},${longitude}`
  const [lookup, setLookup] = useState<{
    key: string
    stations?: EmergencyStation[]
    error?: string
  } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    onStations?.([])
    const timer = setTimeout(() => {
      void lookupEmergencyServices({ latitude, longitude }, controller.signal)
        .then((stations) => {
          if (controller.signal.aborted) return
          setLookup({ key, stations })
          onStations?.(stations)
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setLookup({
              key,
              error: 'Emergency service lookup is unavailable or busy. Wait a moment and retry.',
            })
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
      onStations?.([])
    }
  }, [latitude, longitude, key, retry, onStations])
  const current = lookup?.key === key ? lookup : null
  return (
    <section className="hw-nearby" aria-label="Nearby emergency services">
      <h3>Closest hospitals and fire stations</h3>
      <p className="hw-note">
        Up to 3 of each within {emergencyRadiusKm} km of the selected location. Distances are
        straight-line; opening hours, crew availability and response times are not verified. Search
        coordinates are shared with Overpass.
      </p>
      {!current && <p role="status">Finding nearby emergency services…</p>}
      {current?.error && (
        <div>
          <p className="hw-error" role="alert">
            {current.error}
          </p>
          <button
            className="hw-button hw-secondary"
            onClick={() => {
              setLookup(null)
              setRetry((value) => value + 1)
            }}
          >
            Retry service lookup
          </button>
        </div>
      )}
      {current?.stations && (
        <>
          {current.stations.length === 0 && (
            <p role="status">
              No mapped hospitals or fire stations were found within {emergencyRadiusKm} km. This
              does not mean that emergency assistance is unavailable.
            </p>
          )}
          <div className="hw-emergency-groups">
            {(['hospital', 'fire'] as const).map((kind) => {
              const stations = current.stations!.filter((station) => station.kind === kind)
              const title = kind === 'hospital' ? 'Closest 3 hospitals' : 'Closest 3 fire stations'
              const plural = kind === 'hospital' ? 'hospitals' : 'fire stations'
              return (
                <section key={kind} aria-label={title}>
                  <h4>{title}</h4>
                  {stations.length === 0 ? (
                    <p className="hw-note">
                      No mapped {plural} found within {emergencyRadiusKm} km.
                    </p>
                  ) : (
                    <>
                      {stations.length < 3 && (
                        <p className="hw-note">
                          Only {stations.length} of 3 mapped {plural} found within{' '}
                          {emergencyRadiusKm} km.
                        </p>
                      )}
                      <ol className="hw-station-list">
                        {stations.map((station, index) => (
                          <li key={station.id}>
                            <div className="hw-station-heading">
                              <strong>
                                {kind === 'hospital' ? 'H' : 'F'}
                                {index + 1}. {station.name}
                              </strong>
                              <span>
                                {station.distanceKm < 1
                                  ? `${Math.round(station.distanceKm * 1000)} m`
                                  : `${station.distanceKm.toFixed(1)} km`}
                              </span>
                            </div>
                            {station.address && <p className="hw-note">{station.address}</p>}
                            <p className="hw-station-contacts">
                              {station.phone ? (
                                station.phone.split(';').map((number) => (
                                  <a
                                    key={number}
                                    href={`tel:${number.replace(/[^\d+]/g, '')}`}
                                    aria-label={`Call ${station.name}: ${number.trim()}`}
                                  >
                                    {number.trim()}
                                  </a>
                                ))
                              ) : (
                                <span className="hw-note">Phone not listed.</span>
                              )}
                              {station.website && (
                                <a
                                  href={station.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`Website for ${station.name} (opens in a new tab)`}
                                >
                                  Website ↗
                                </a>
                              )}
                            </p>
                            <MapDirectionLinks
                              latitude={station.latitude}
                              longitude={station.longitude}
                            />
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </section>
              )
            })}
          </div>
          <p className="hw-note">
            Service data ©{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap contributors
            </a>
            . Coverage and published contact details may be incomplete or outdated. Call 000 in
            Australia or 111 in New Zealand for emergencies.
          </p>
        </>
      )}
    </section>
  )
}

export function EmergencyServiceFinder() {
  const [location, setLocation] = useState('')
  const [coordinates, setCoordinates] = useState<Coordinates | undefined>()
  const point =
    coordinates &&
    emergencyPointSchema.safeParse({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    })
  return (
    <section className="hw-panel hw-emergency-finder" aria-label="Find closest emergency service">
      <div className="hw-emergency-heading">
        <MapPin size={22} aria-hidden="true" />
        <h2>Find closest emergency service</h2>
      </div>
      <p className="hw-emergency-call">
        If you are in immediate danger, call <a href="tel:000">000 in Australia</a> or{' '}
        <a href="tel:111">111 in New Zealand</a>.
      </p>
      <p>
        Find the closest 3 hospitals and 3 fire stations using an address, place, coordinates or
        your device location.
      </p>
      <p className="hw-note">
        Address search uses the same lookup as media submissions. Confirm a location to search; its
        coordinates are shared with Overpass.
      </p>
      <LocationInput
        purpose="search"
        location={location}
        coordinates={coordinates}
        onChange={(label, point) => {
          setLocation(label)
          setCoordinates(point)
        }}
      />
      {point?.success && (
        <NearbyEmergencyServices
          key={`${point.data.latitude},${point.data.longitude}`}
          {...point.data}
        />
      )}
    </section>
  )
}
