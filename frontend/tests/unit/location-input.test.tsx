import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LocationInput } from '@/features/hazardwatch/components/LocationInput'
import { coordinatesFromText, type Coordinates } from '@/features/hazardwatch/location'

const service = vi.hoisted(() => ({ places: vi.fn(), addresses: vi.fn() }))
vi.mock('@/features/hazardwatch/location', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  suggestPlaces: service.places,
  searchAddresses: service.addresses,
}))

type InputProps = Parameters<typeof LocationInput>[0]
function Harness({
  onChange,
  ...props
}: Omit<InputProps, 'location' | 'coordinates' | 'onChange'> & {
  onChange?: InputProps['onChange']
}) {
  const [value, setValue] = useState<{ location: string; coordinates?: Coordinates }>({
    location: '',
  })
  return (
    <LocationInput
      {...props}
      {...value}
      onChange={(location, coordinates) => {
        setValue({ location, coordinates })
        onChange?.(location, coordinates)
      }}
    />
  )
}

beforeEach(async () => {
  const original = await vi.importActual<typeof import('@/features/hazardwatch/location')>(
    '@/features/hazardwatch/location'
  )
  service.addresses.mockReset().mockResolvedValue([])
  service.places.mockReset().mockImplementation(original.suggestPlaces)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('local place suggestions confirm map coordinates and editing the query invalidates them', async () => {
  const change = vi.fn()
  render(<Harness onChange={change} />)
  fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: 'Katoomba' } })
  const suggestion = await screen.findByRole('button', { name: /^Katoomba,/ }, { timeout: 3000 })
  fireEvent.click(suggestion)
  expect(change).toHaveBeenLastCalledWith(
    expect.stringContaining('Katoomba'),
    expect.objectContaining({
      source: 'place',
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    })
  )
  expect(screen.getByText(/Location confirmed:/).closest('p')).toHaveTextContent('Selected place')
  fireEvent.change(screen.getByLabelText(/^Location/), {
    target: { value: 'Different capture point' },
  })
  expect(change).toHaveBeenLastCalledWith('Different capture point', undefined)
  expect(screen.queryByText(/Location confirmed:/)).not.toBeInTheDocument()
})

test('device coordinates retain reported accuracy and denied permission permits manual fallback', () => {
  const getCurrentPosition = vi.fn()
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  const change = vi.fn()
  render(<Harness onChange={change} />)
  fireEvent.click(screen.getByRole('button', { name: 'Use device location' }))
  act(() =>
    getCurrentPosition.mock.calls[0]![0]({
      coords: {
        latitude: -33.87,
        longitude: 151.21,
        accuracy: 12.3,
      },
    })
  )
  expect(change).toHaveBeenLastCalledWith('Device location', {
    latitude: -33.87,
    longitude: 151.21,
    accuracy: 12.3,
    source: 'device',
  })
  expect(screen.getByText(/Location confirmed:/).closest('p')).toHaveTextContent('±12 m')
  fireEvent.click(screen.getByRole('button', { name: 'Use device location' }))
  act(() => getCurrentPosition.mock.calls[1]![1]({ code: 1 }))
  expect(screen.getByText(/Location permission was denied/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '-41.2866' } })
  fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '174.7756' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply coordinates' }))
  expect(change).toHaveBeenLastCalledWith('Device location', {
    latitude: -41.2866,
    longitude: 174.7756,
    source: 'coordinates',
  })
})

test('blank and invalid coordinates cannot be applied; globally valid points flag map coverage', () => {
  render(<Harness />)
  const apply = screen.getByRole('button', { name: 'Apply coordinates' })
  expect(apply).toBeDisabled()
  for (const [latitude, longitude] of [
    [' ', '0'],
    ['0', ''],
    ['NaN', '0'],
    ['91', '151'],
    ['-33', '181'],
  ]) {
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: latitude } })
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: longitude } })
    expect(apply).toBeDisabled()
    expect(coordinatesFromText(latitude!, longitude!)).toBeUndefined()
  }
  fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '0' } })
  expect(apply).toBeEnabled()
  fireEvent.click(apply)
  expect(
    screen.getByText(/Outside current Australia\/New Zealand map coverage/)
  ).toBeInTheDocument()
})

test('extracted video metadata requires explicit confirmation and a failed place search offers fallback', async () => {
  service.places.mockRejectedValueOnce(new Error('Catalogue unavailable'))
  const change = vi.fn()
  render(
    <Harness
      onChange={change}
      metadata={{
        status: 'found',
        latitude: -41.2866,
        longitude: 174.7756,
        source: 'quicktime',
        detail: 'Video GPS found.',
      }}
    />
  )
  expect(change).not.toHaveBeenCalled()
  expect(screen.queryByText(/Location confirmed:/)).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: 'Wellington' } })
  await screen.findByText(/Place search is unavailable/)
  fireEvent.click(screen.getByRole('button', { name: 'Use location from media' }))
  expect(change).toHaveBeenLastCalledWith('Wellington', {
    latitude: -41.2866,
    longitude: 174.7756,
    source: 'quicktime',
  })
  expect(screen.getByText(/Location confirmed:/).closest('p')).toHaveTextContent(
    'Video location metadata'
  )
})

test('a device response arriving after location editing cannot overwrite the entered place', () => {
  const getCurrentPosition = vi.fn()
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  const change = vi.fn()
  render(<Harness onChange={change} />)
  fireEvent.click(screen.getByRole('button', { name: 'Use device location' }))
  fireEvent.change(screen.getByLabelText(/^Location/), {
    target: { value: 'Actual capture location' },
  })
  act(() =>
    getCurrentPosition.mock.calls[0]![0]({
      coords: {
        latitude: -33.87,
        longitude: 151.21,
        accuracy: 10,
      },
    })
  )
  expect(change).toHaveBeenLastCalledWith('Actual capture location', undefined)
  expect(screen.queryByText(/Location confirmed:/)).not.toBeInTheDocument()
})

test('street lookup requires selection and retains the full numbered address while stale edits cancel its response', async () => {
  const change = vi.fn()
  const address = {
    label: '257 Test Road, Glenroy, Victoria, Australia',
    coordinates: { latitude: -37.81, longitude: 144.96, source: 'address' as const },
  }
  service.addresses.mockResolvedValueOnce([address])
  render(<Harness onChange={change} />)
  fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: '257 test road' } })
  expect(service.addresses).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Find address' }))
  const match = await screen.findByRole('button', { name: address.label })
  expect(screen.queryByText(/Location confirmed:/)).not.toBeInTheDocument()
  fireEvent.click(match)
  expect(change).toHaveBeenLastCalledWith(address.label, address.coordinates)
  expect(screen.getByLabelText(/^Location/)).toHaveValue(address.label)
  expect(screen.getByText(/Location confirmed:/).closest('p')).toHaveTextContent('Selected address')
  let resolve!: (value: (typeof address)[]) => void
  service.addresses.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    })
  )
  fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: '257 Test Road' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find address' }))
  const signal = service.addresses.mock.calls[1]![1] as AbortSignal
  fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: 'Different location' } })
  expect(signal.aborted).toBe(true)
  await act(async () => resolve([address]))
  expect(screen.queryByRole('button', { name: address.label })).not.toBeInTheDocument()
  expect(change).toHaveBeenLastCalledWith('Different location', undefined)
})

test('unmatched or failed address search keeps manual and offline location inputs available', async () => {
  render(<Harness />)
  fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: '257 Test Road' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find address' }))
  await screen.findByText(/No matching street address found/)
  expect(screen.queryByText(/Location confirmed:/)).not.toBeInTheDocument()
  service.addresses.mockRejectedValueOnce(new Error('Lookup unavailable.'))
  fireEvent.click(screen.getByRole('button', { name: 'Find address' }))
  await screen.findByText('Lookup unavailable.')
  fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '-37.81' } })
  fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '144.96' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply coordinates' }))
  expect(screen.getByText(/Location confirmed:/).closest('p')).toHaveTextContent(
    'Entered coordinates'
  )
})

test('invalid coordinate fields explain decimal ranges and clear errors after correction', () => {
  render(<Harness />)
  const latitude = screen.getByLabelText('Latitude')
  const longitude = screen.getByLabelText('Longitude')
  const apply = screen.getByRole('button', { name: 'Apply coordinates' })
  expect(latitude).not.toHaveAttribute('aria-invalid')
  expect(longitude).not.toHaveAttribute('aria-invalid')
  expect(screen.queryByText(/must be decimal degrees/)).not.toBeInTheDocument()
  for (const value of ['91', '-91', 'NaN', '1e2', '-33,87']) {
    fireEvent.change(latitude, { target: { value } })
    expect(latitude).toHaveAttribute('aria-invalid', 'true')
    expect(latitude).toHaveAccessibleDescription('Latitude must be decimal degrees from -90 to 90.')
    expect(longitude).not.toHaveAttribute('aria-invalid')
    expect(apply).toBeDisabled()
  }
  fireEvent.change(latitude, { target: { value: '-33.87' } })
  expect(latitude).not.toHaveAttribute('aria-invalid')
  expect(screen.queryByText(/Latitude must/)).not.toBeInTheDocument()
  for (const value of ['181', '-181', 'Infinity', '151 E']) {
    fireEvent.change(longitude, { target: { value } })
    expect(longitude).toHaveAttribute('aria-invalid', 'true')
    expect(longitude).toHaveAccessibleDescription(
      'Longitude must be decimal degrees from -180 to 180.'
    )
    expect(latitude).not.toHaveAttribute('aria-invalid')
    expect(apply).toBeDisabled()
  }
  fireEvent.change(longitude, { target: { value: ' ' } })
  expect(longitude).not.toHaveAttribute('aria-invalid')
  expect(screen.queryByText(/Longitude must/)).not.toBeInTheDocument()
  expect(apply).toBeDisabled()
  fireEvent.change(longitude, { target: { value: '151.21' } })
  expect(apply).toBeEnabled()
})
