'use client'

import { useEffect, useRef, useState } from 'react'
import {
  coordinatesFromText,
  coordinateSchema,
  inMapCoverage,
  locationSources,
  suggestPlaces,
  searchAddresses,
  type Coordinates,
  type PlaceSuggestion,
} from '@/features/hazardwatch/location'
import type { MediaLocationMetadata } from '@/features/hazardwatch/api'

export function LocationInput({
  location,
  coordinates,
  onChange,
  metadata,
  metadataBusy,
  metadataNotice,
  purpose = 'capture',
}: {
  location: string
  coordinates?: Coordinates
  onChange: (location: string, coordinates?: Coordinates) => void
  metadata?: MediaLocationMetadata | null
  metadataBusy?: boolean
  metadataNotice?: string
  purpose?: 'capture' | 'search'
}) {
  const searching = purpose === 'search'
  const prefix = searching ? 'hw-search' : 'hw'
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [addresses, setAddresses] = useState<PlaceSuggestion[]>([])
  const [searchingAddress, setSearchingAddress] = useState(false)
  const addressRequest = useRef<AbortController | null>(null)
  const [latitude, setLatitude] = useState(coordinates ? String(coordinates.latitude) : '')
  const [longitude, setLongitude] = useState(coordinates ? String(coordinates.longitude) : '')
  const [locating, setLocating] = useState(false)
  const [notice, setNotice] = useState('')
  const request = useRef(0)
  const entered = coordinatesFromText(latitude, longitude)
  const latitudeInvalid = latitude.trim().length > 0 && !coordinatesFromText(latitude, '0')
  const longitudeInvalid = longitude.trim().length > 0 && !coordinatesFromText('0', longitude)
  useEffect(
    () => () => {
      request.current++
      addressRequest.current?.abort()
    },
    []
  )
  useEffect(() => {
    if (coordinates || location.trim().length < 2) return
    let cancelled = false
    const timer = setTimeout(() => {
      void suggestPlaces(location)
        .then((results) => {
          if (!cancelled) setSuggestions(results)
        })
        .catch(() => {
          if (!cancelled)
            setNotice('Place search is unavailable. Enter coordinates or use your device location.')
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [location, coordinates])

  function invalidate() {
    request.current++
    addressRequest.current?.abort()
    addressRequest.current = null
    setSearchingAddress(false)
    setAddresses([])
    setLocating(false)
    setSuggestions([])
    setNotice('')
  }
  function confirm(label: string, point: Coordinates) {
    invalidate()
    setLatitude(String(point.latitude))
    setLongitude(String(point.longitude))
    onChange(label, point)
  }
  async function findAddress() {
    invalidate()
    const version = ++request.current
    const controller = new AbortController()
    addressRequest.current = controller
    setSearchingAddress(true)
    try {
      const results = await searchAddresses(location, controller.signal)
      if (version !== request.current) return
      setAddresses(results)
      setNotice(
        results.length
          ? ''
          : 'No matching street address found. Add the suburb or postcode, or enter coordinates. A suburb centre will not be used.'
      )
    } catch (error) {
      if (version === request.current && !controller.signal.aborted)
        setNotice(
          error instanceof Error
            ? error.message
            : 'Address lookup is unavailable. Enter coordinates or select a place.'
        )
    } finally {
      if (version === request.current) setSearchingAddress(false)
    }
  }
  function locate() {
    invalidate()
    if (!navigator.geolocation) {
      setNotice('Device location is unavailable. Enter coordinates or select a place.')
      return
    }
    const version = ++request.current
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (version !== request.current) return
        const result = coordinateSchema.safeParse({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          source: 'device',
          accuracy: position.coords.accuracy,
        })
        setLocating(false)
        if (!result.success) {
          setNotice('The device returned invalid coordinates. Choose another location method.')
          return
        }
        confirm(searching ? 'Current device location' : location || 'Device location', result.data)
      },
      (error) => {
        if (version !== request.current) return
        setLocating(false)
        setNotice(
          error.code === 1
            ? 'Location permission was denied. Select a place or enter coordinates.'
            : 'Device location could not be obtained. Select a place or enter coordinates.'
        )
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  return (
    <fieldset className="hw-location-input">
      <legend>{searching ? 'Search location' : 'Capture location'}</legend>
      <div className="hw-field">
        <label htmlFor={`${prefix}-location`}>
          {searching ? (
            'Address or place'
          ) : (
            <>
              Location <span>Required</span>
            </>
          )}
        </label>
        <input
          id={`${prefix}-location`}
          autoComplete="off"
          maxLength={240}
          required={!searching}
          value={location}
          onChange={(event) => {
            invalidate()
            onChange(event.target.value, undefined)
          }}
          placeholder="Street address, town, region or named place…"
          aria-describedby={`${prefix}-location-help`}
        />
        <small id={`${prefix}-location-help`}>
          Place suggestions work offline. Find address sends this input to online address lookup;
          include the suburb or postcode for a more precise match.
        </small>
        <button
          type="button"
          className="hw-text-button"
          onClick={() => void findAddress()}
          disabled={location.trim().length < 4 || searchingAddress}
        >
          {searchingAddress ? 'Finding address…' : 'Find address'}
        </button>
        {addresses.length > 0 && (
          <>
            <ul className="hw-place-suggestions" aria-label="Matching street addresses">
              {addresses.map((address) => (
                <li key={address.label}>
                  <button type="button" onClick={() => confirm(address.label, address.coordinates)}>
                    {address.label}
                  </button>
                </li>
              ))}
            </ul>
            <small>
              Address data ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap contributors
              </a>
              . Select a match to confirm its mapped point.
            </small>
          </>
        )}
        {suggestions.length > 0 && (
          <ul className="hw-place-suggestions" aria-label="Suggested locations">
            {suggestions.map((suggestion) => (
              <li
                key={`${suggestion.label}-${suggestion.coordinates.latitude}-${suggestion.coordinates.longitude}`}
              >
                <button
                  type="button"
                  onClick={() => confirm(suggestion.label.slice(0, 240), suggestion.coordinates)}
                >
                  {suggestion.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {metadataBusy && (
        <p role="status" className="hw-note">
          Checking media location metadata… You can enter a location meanwhile.
        </p>
      )}
      {metadata?.status === 'found' && metadata.source && (
        <div className="hw-metadata-found">
          <p>
            {locationSources[metadata.source]}: {metadata.latitude?.toFixed(6)},{' '}
            {metadata.longitude?.toFixed(6)}
          </p>
          <button
            type="button"
            className="hw-button hw-secondary"
            onClick={() =>
              confirm(location || 'Media capture location', {
                latitude: metadata.latitude!,
                longitude: metadata.longitude!,
                source: metadata.source!,
              })
            }
          >
            Use location from media
          </button>
        </div>
      )}
      {(metadataNotice || (metadata && metadata.status !== 'found')) && (
        <p className="hw-note" role="status">
          {metadataNotice || metadata?.detail} Select a place, enter coordinates, or use device
          location.
        </p>
      )}
      <div className="hw-coordinate-grid">
        <div className="hw-field">
          <label htmlFor={`${prefix}-latitude`}>Latitude</label>
          <input
            id={`${prefix}-latitude`}
            type="text"
            inputMode="decimal"
            value={latitude}
            placeholder="-33.87"
            aria-invalid={latitudeInvalid || undefined}
            aria-describedby={latitudeInvalid ? `${prefix}-latitude-error` : undefined}
            onChange={(event) => {
              invalidate()
              setLatitude(event.target.value)
              onChange(location, undefined)
            }}
          />
          {latitudeInvalid && (
            <small id={`${prefix}-latitude-error`} className="hw-error" role="status">
              Latitude must be decimal degrees from -90 to 90.
            </small>
          )}
        </div>
        <div className="hw-field">
          <label htmlFor={`${prefix}-longitude`}>Longitude</label>
          <input
            id={`${prefix}-longitude`}
            type="text"
            inputMode="decimal"
            value={longitude}
            placeholder="151.21"
            aria-invalid={longitudeInvalid || undefined}
            aria-describedby={longitudeInvalid ? `${prefix}-longitude-error` : undefined}
            onChange={(event) => {
              invalidate()
              setLongitude(event.target.value)
              onChange(location, undefined)
            }}
          />
          {longitudeInvalid && (
            <small id={`${prefix}-longitude-error`} className="hw-error" role="status">
              Longitude must be decimal degrees from -180 to 180.
            </small>
          )}
        </div>
      </div>
      <div className="hw-inline-actions">
        <button
          type="button"
          className="hw-button hw-secondary"
          disabled={!entered}
          onClick={() =>
            confirm(
              searching ? 'Entered search coordinates' : location || 'Entered capture coordinates',
              entered!
            )
          }
        >
          Apply coordinates
        </button>
        <button type="button" className="hw-text-button" onClick={locate} disabled={locating}>
          {locating ? 'Getting device location…' : 'Use device location'}
        </button>
      </div>
      <p className="hw-note">
        {searching
          ? 'Select an address or place, apply coordinates, or use your current device location to find nearby services.'
          : 'Use signed decimal degrees. Device location is your position now; confirm that it matches where the media was captured.'}
      </p>
      {notice && (
        <p role="status" className="hw-error">
          {notice}
        </p>
      )}
      {coordinates ? (
        <p role="status" className="hw-confirmed-location">
          <strong>Location confirmed:</strong> {coordinates.latitude.toFixed(6)},{' '}
          {coordinates.longitude.toFixed(6)} · {locationSources[coordinates.source]}
          {coordinates.source === 'address' && (
            <span>
              Address data ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap contributors
              </a>
              ;{' '}
              {searching
                ? 'check that this is the search address.'
                : 'check that this is the capture address.'}
            </span>
          )}
          {coordinates.accuracy !== undefined && ` · ±${Math.round(coordinates.accuracy)} m`}
          {!inMapCoverage(coordinates) && (
            <span>
              {searching
                ? 'Outside Australia/New Zealand coverage; nearby services cannot be searched here.'
                : 'Outside current Australia/New Zealand map coverage; this report cannot be added to the map.'}
            </span>
          )}
        </p>
      ) : (
        <p className="hw-note">
          Confirm coordinates with one of the options above before continuing.
        </p>
      )}
    </fieldset>
  )
}
