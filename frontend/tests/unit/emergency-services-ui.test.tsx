import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  EmergencyServiceFinder,
  NearbyEmergencyServices,
} from '@/features/hazardwatch/components/EmergencyServices'
import { LocationInput } from '@/features/hazardwatch/components/LocationInput'
import type { EmergencyStation } from '@/features/hazardwatch/emergency-services'

const services = vi.hoisted(() => ({ lookup: vi.fn(), addresses: vi.fn(), places: vi.fn() }))
vi.mock('@/features/hazardwatch/emergency-services', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  lookupEmergencyServices: services.lookup,
}))
vi.mock('@/features/hazardwatch/location', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  searchAddresses: services.addresses,
  suggestPlaces: services.places,
}))
const point = { latitude: -37.8136, longitude: 144.9631 }
const stations: EmergencyStation[] = (['hospital', 'fire'] as const).flatMap((kind, group) =>
  [1, 2, 3].map((index) => ({
    id: `node/${group * 3 + index}`,
    name: `Test ${kind} ${index}`,
    kind,
    latitude: -37.8136 - index * 0.001,
    longitude: 144.96312345 + index * 0.001,
    distanceKm: 0.5 + index,
    address: index === 1 ? 'Test Street' : '',
    phone: index === 1 ? '+61 (3) 5550.0101' : '',
    website: index === 1 ? 'https://example.org/' : '',
    emergencyDepartment: index === 1 ? ('yes' as const) : ('unknown' as const),
  }))
)
beforeEach(() => {
  vi.useFakeTimers()
  services.lookup.mockReset().mockResolvedValue(stations)
  services.addresses.mockReset().mockResolvedValue([])
  services.places.mockReset().mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function finishLookup() {
  await act(async () => {
    vi.advanceTimersByTime(301)
  })
}
function enterPoint(latitude = '-37.8136', longitude = '144.9631') {
  fireEvent.change(screen.getByLabelText('Latitude', { exact: true }), {
    target: { value: latitude },
  })
  fireEvent.change(screen.getByLabelText('Longitude', { exact: true }), {
    target: { value: longitude },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Apply coordinates' }))
}

test('overview keeps emergency links and waits for a confirmed location before lookup', async () => {
  const getCurrentPosition = vi.fn()
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  render(<EmergencyServiceFinder />)
  expect(
    screen.getByRole('heading', { name: 'Find closest emergency service' })
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '000 in Australia' })).toHaveAttribute('href', 'tel:000')
  expect(screen.getByRole('link', { name: '111 in New Zealand' })).toHaveAttribute(
    'href',
    'tel:111'
  )
  expect(screen.getByRole('textbox', { name: 'Address or place' })).toBeInTheDocument()
  await finishLookup()
  expect(getCurrentPosition).not.toHaveBeenCalled()
  expect(services.lookup).not.toHaveBeenCalled()
  enterPoint()
  await finishLookup()
  expect(services.lookup).toHaveBeenCalledWith(point, expect.any(AbortSignal))
  expect(screen.getAllByRole('listitem')).toHaveLength(6)
})

test.each(['', 'abc', '91'])('invalid latitude %s cannot start a lookup', async (value) => {
  render(<EmergencyServiceFinder />)
  fireEvent.change(screen.getByLabelText('Latitude', { exact: true }), { target: { value } })
  fireEvent.change(screen.getByLabelText('Longitude', { exact: true }), {
    target: { value: '144.9631' },
  })
  expect(screen.getByRole('button', { name: 'Apply coordinates' })).toBeDisabled()
  await finishLookup()
  expect(services.lookup).not.toHaveBeenCalled()
})

test('coordinates outside AU/NZ give a clear coverage message without querying', async () => {
  render(<EmergencyServiceFinder />)
  enterPoint('51', '0')
  expect(screen.getByText(/Outside Australia\/New Zealand coverage/)).toBeInTheDocument()
  await finishLookup()
  expect(services.lookup).not.toHaveBeenCalled()
})

test.each([1, 2, 3])(
  'device error %s leaves address and coordinate fallback available',
  async (code) => {
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: vi.fn((_success, failure) => failure({ code })) },
    })
    render(<EmergencyServiceFinder />)
    fireEvent.click(screen.getByRole('button', { name: 'Use device location' }))
    expect(
      screen.getByText(
        code === 1 ? /Location permission was denied/ : /Device location could not be obtained/
      )
    ).toBeInTheDocument()
    enterPoint()
    await finishLookup()
    expect(services.lookup).toHaveBeenCalledWith(point, expect.any(AbortSignal))
  }
)

test('device success uses its point and late device callbacks cannot overwrite a manual choice', async () => {
  const getCurrentPosition = vi.fn()
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  render(<EmergencyServiceFinder />)
  const button = screen.getByRole('button', { name: 'Use device location' })
  fireEvent.click(button)
  act(() => getCurrentPosition.mock.calls[0]![0]({ coords: point }))
  await finishLookup()
  expect(services.lookup).toHaveBeenLastCalledWith(point, expect.any(AbortSignal))
  fireEvent.click(button)
  enterPoint('-41.28664', '174.77557')
  act(() => getCurrentPosition.mock.calls[1]![0]({ coords: point }))
  await finishLookup()
  expect(services.lookup).toHaveBeenLastCalledWith(
    { latitude: -41.28664, longitude: 174.77557 },
    expect.any(AbortSignal)
  )
})

test('the existing street-address lookup requires selection, preserves exact house coordinates and cancels edits', async () => {
  const address = {
    label: '10 Test Street, Melbourne, Victoria, Australia',
    coordinates: {
      ...point,
      longitude: 144.96312345,
      source: 'address' as const,
      countryCode: 'AU' as const,
    },
  }
  services.addresses.mockResolvedValueOnce([address])
  render(<EmergencyServiceFinder />)
  const field = screen.getByRole('textbox', { name: 'Address or place' })
  fireEvent.change(field, { target: { value: '10 Test Street, Melbourne' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Find address' })))
  expect(services.addresses).toHaveBeenCalledWith(
    '10 Test Street, Melbourne',
    expect.any(AbortSignal)
  )
  expect(services.lookup).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: address.label }))
  await finishLookup()
  expect(field).toHaveValue(address.label)
  expect(services.lookup).toHaveBeenLastCalledWith(
    { latitude: point.latitude, longitude: 144.96312345 },
    expect.any(AbortSignal)
  )
  fireEvent.change(field, { target: { value: 'Different address' } })
  expect(
    screen.queryByRole('region', { name: 'Nearby emergency services' })
  ).not.toBeInTheDocument()
  let resolve!: (addresses: (typeof address)[]) => void
  services.addresses.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Find address' })))
  const signal = services.addresses.mock.calls[1]![1] as AbortSignal
  fireEvent.change(field, { target: { value: 'Changed again' } })
  expect(signal.aborted).toBe(true)
  await act(async () => resolve([address]))
  expect(screen.queryByRole('button', { name: address.label })).not.toBeInTheDocument()
})

test('search and upload controls have different IDs and preserve capture behavior', () => {
  render(
    <>
      <EmergencyServiceFinder />
      <LocationInput location="" onChange={vi.fn()} />
    </>
  )
  const search = within(screen.getByRole('region', { name: 'Find closest emergency service' }))
  const capture = within(screen.getByRole('group', { name: 'Capture location' }))
  expect(search.getByLabelText('Latitude', { exact: true }).id).not.toBe(
    capture.getByLabelText('Latitude', { exact: true }).id
  )
  expect(search.getByRole('textbox', { name: 'Address or place' })).not.toBeRequired()
  expect(capture.getByRole('textbox', { name: /Location/ })).toBeRequired()
})

test('independent hospital/fire groups display three each, contacts and exact per-facility directions', async () => {
  const onStations = vi.fn()
  render(<NearbyEmergencyServices {...point} onStations={onStations} />)
  expect(onStations).toHaveBeenLastCalledWith([])
  await finishLookup()
  expect(onStations).toHaveBeenLastCalledWith(stations)
  for (const [kind, title] of [
    ['hospital', 'Closest 3 hospitals'],
    ['fire', 'Closest 3 fire stations'],
  ] as const) {
    const group = within(screen.getByRole('region', { name: title }))
    expect(group.getAllByRole('listitem')).toHaveLength(3)
    for (const [index, station] of stations.filter((station) => station.kind === kind).entries()) {
      const row = group.getAllByRole('listitem')[index]!
      expect(row).toHaveTextContent(station.name)
      for (const service of ['Google', 'Apple']) {
        expect(
          new URL(
            within(row)
              .getByRole('link', { name: new RegExp(`Directions in ${service} Maps`) })
              .getAttribute('href')!
          ).searchParams.get('destination')
        ).toBe(`${station.latitude},${station.longitude}`)
      }
      if (station.phone)
        expect(
          within(row).getByRole('link', { name: new RegExp(`Call ${station.name}`) })
        ).toHaveAttribute('href', 'tel:+61355500101')
      else expect(row).toHaveTextContent('Phone not listed.')
      if (station.website)
        expect(
          within(row).getByRole('link', { name: new RegExp(`Website for ${station.name}`) })
        ).toHaveAttribute('href', 'https://example.org/')
    }
  }
  const results = screen.getByRole('region', { name: 'Nearby emergency services' })
  expect(results).not.toHaveTextContent(/emergency department/i)
  expect(results).not.toHaveTextContent(point.latitude.toFixed(6))
  expect(results).not.toHaveTextContent(point.longitude.toFixed(6))
  for (const station of stations) {
    expect(results).not.toHaveTextContent(station.latitude.toFixed(6))
    expect(results).not.toHaveTextContent(station.longitude.toFixed(6))
  }
  expect(screen.queryByText(/police/i)).not.toBeInTheDocument()
})

test('empty, missing-category and fewer results explain coverage without inventing facilities', async () => {
  services.lookup.mockResolvedValueOnce([])
  const rendered = render(<NearbyEmergencyServices {...point} />)
  await finishLookup()
  expect(screen.getByRole('status')).toHaveTextContent(
    'This does not mean that emergency assistance is unavailable'
  )
  expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  services.lookup.mockResolvedValueOnce(stations.slice(0, 1))
  rendered.rerender(<NearbyEmergencyServices latitude={-37.82} longitude={point.longitude} />)
  await finishLookup()
  expect(screen.getByText(/Only 1 of 3 mapped hospitals/)).toBeInTheDocument()
  expect(screen.getByText(/No mapped fire stations/)).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
})

test('unavailable results can be retried', async () => {
  services.lookup.mockRejectedValueOnce(new Error('provider error'))
  render(<NearbyEmergencyServices {...point} />)
  await finishLookup()
  expect(screen.getByRole('alert')).toHaveTextContent('unavailable or busy')
  fireEvent.click(screen.getByRole('button', { name: 'Retry service lookup' }))
  await finishLookup()
  expect(screen.getAllByRole('listitem')).toHaveLength(6)
})

test('changing a hazard aborts and clears its results; late responses cannot replace current results', async () => {
  let resolve!: (stations: EmergencyStation[]) => void
  services.lookup.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const onStations = vi.fn()
  const rendered = render(<NearbyEmergencyServices {...point} onStations={onStations} />)
  await finishLookup()
  const firstSignal = services.lookup.mock.calls[0]![1] as AbortSignal
  rendered.rerender(
    <NearbyEmergencyServices latitude={-41.28664} longitude={174.77557} onStations={onStations} />
  )
  expect(firstSignal.aborted).toBe(true)
  expect(onStations).toHaveBeenLastCalledWith([])
  await finishLookup()
  await act(async () => resolve([{ ...stations[0]!, name: 'Stale hospital' }]))
  expect(screen.queryByText(/Stale hospital/)).not.toBeInTheDocument()
  expect(onStations).toHaveBeenLastCalledWith(stations)
  rendered.unmount()
  expect(onStations).toHaveBeenLastCalledWith([])
})
