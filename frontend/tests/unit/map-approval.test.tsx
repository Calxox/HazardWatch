import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createRequire } from 'node:module'
import { HazardWorkspace } from '@/features/hazardwatch/components/HazardWorkspace'
import { ClassificationResult } from '@/features/hazardwatch/components/ClassificationResult'
import { HazardDirections } from '@/features/hazardwatch/components/HazardDirections'
import { ReportFilters } from '@/features/hazardwatch/components/Screens'
import {
  filterIncidents,
  reportToIncident,
  sortIncidentsBySeverity,
  type Incident,
  type Report,
  type Severity,
} from '@/features/hazardwatch/model'
import type { Coordinates } from '@/features/hazardwatch/location'

const fixtures = vi.hoisted(() => ({
  coordinates: {
    latitude: -41.28664,
    longitude: 174.77557,
    source: 'coordinates',
  } as Coordinates | undefined,
  severity: 'High' as Severity,
  chat: vi.fn(),
  stationsLookup: vi.fn(),
  mapVisible: undefined as ((ids: string[]) => void) | undefined,
}))

vi.mock('@/features/hazardwatch/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  chatAboutAssessment: fixtures.chat,
}))
vi.mock('@/features/hazardwatch/emergency-services', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  lookupEmergencyServices: fixtures.stationsLookup,
}))
vi.mock('@/features/hazardwatch/components/HazardMap', () => ({
  HazardMap: ({
    items,
    onSelect,
    stations,
    onVisible,
  }: {
    items: Incident[]
    onSelect: (id: string) => void
    stations: unknown[]
    onVisible?: (ids: string[]) => void
  }) => {
    fixtures.mapVisible = onVisible
    return (
      <div aria-label="Test map" data-station-count={stations.length}>
        {items.map((item) => (
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            key={item.id}
            data-testid={`marker-${item.id}`}
            data-lat={item.lat}
            data-lng={item.lng}
          >
            {item.name}
          </button>
        ))}
      </div>
    )
  },
}))
vi.mock('@/features/hazardwatch/components/ImageUpload', () => ({
  ImageUpload: ({
    onSubmit,
    onClose,
  }: {
    onSubmit: (report: Omit<Report, 'id'>) => string
    onClose: () => void
  }) => (
    <button
      onClick={() => {
        onSubmit({
          ...testReport,
          coordinates: fixtures.coordinates,
          assessment: { ...testReport.assessment!, severity: fixtures.severity },
        })
        onClose()
      }}
    >
      Submit test media
    </button>
  ),
  ReportPreview: ({ report }: { report: Report }) => <p>Evidence: {report.location}</p>,
}))

const testReport: Omit<Report, 'id'> = {
  location: 'Wellington test report',
  date: '2026-09-14T14:28',
  source: 'Ground/Citizen',
  notes: 'Location reviewed by the operator.',
  coordinates: { latitude: -41.28664, longitude: 174.77557, source: 'coordinates' },
  preview: '/test-evidence.jpg',
  mediaType: 'image',
  assessment: {
    severity: 'High',
    confidence: 85,
    hazard: 'Active bushfire',
    keyFeatures: ['actual_flames'],
    keyFeatureScores: { actual_flames: 85 },
    explainability: 'Flames visible.',
    modality: 'ground',
    inputType: 'image',
  },
}
const testIncident = reportToIncident({ ...testReport, id: 'HW-TEST', approved: true })!

beforeEach(() => {
  fixtures.coordinates = {
    latitude: -41.28664,
    longitude: 174.77557,
    source: 'coordinates',
  }
  fixtures.severity = 'High'
  fixtures.chat.mockReset()
  fixtures.stationsLookup.mockReset().mockResolvedValue([])
  fixtures.mapVisible = undefined
  window.history.replaceState(null, '', '#overview')
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  window.scrollTo = vi.fn()
})
afterEach(cleanup)

async function openView(name: string, heading: string) {
  fireEvent.click(screen.getByRole('link', { name }))
  await screen.findByRole('heading', { name: heading, level: 1 })
}
async function addReport() {
  fireEvent.click(screen.getByRole('button', { name: 'Submit media' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit test media' }))
}
async function approveReport() {
  await openView('Media reports', 'Media reports')
  fireEvent.click(screen.getByRole('button', { name: 'Review report' }))
  fireEvent.click(screen.getByRole('button', { name: 'Approve and add to map' }))
  return (
    await within(await screen.findByLabelText('Test map')).findAllByText('Wellington test report')
  )[0]!
}
async function setView(view: string) {
  await act(async () => {
    window.history.replaceState(null, '', `#${view}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

test('severity order covers every level, preserves equal-level order, and does not mutate inputs', () => {
  const items: Incident[] = [
    { ...testIncident, id: 'high-first', severity: 'High' },
    { ...testIncident, id: 'low-first', severity: 'Low' },
    { ...testIncident, id: 'none', severity: 'None' },
    { ...testIncident, id: 'high-second', severity: 'High' },
    { ...testIncident, id: 'moderate', severity: 'Moderate' },
    { ...testIncident, id: 'extreme', severity: 'Extreme' },
    { ...testIncident, id: 'low-second', severity: 'Low' },
  ]
  const original = [...items]
  const sorted = sortIncidentsBySeverity(items)
  expect(sorted.map((item) => item.id)).toEqual([
    'extreme',
    'high-first',
    'high-second',
    'moderate',
    'low-first',
    'low-second',
    'none',
  ])
  expect(sorted).not.toBe(items)
  expect(items).toEqual(original)
  expect(sortIncidentsBySeverity([])).toEqual([])
})

test('severity filters preserve order and coordinate-only reports', () => {
  const low = { ...testIncident, id: 'low', severity: 'Low' as const }
  const unknown = { ...testIncident, id: 'unknown', countryCode: undefined, region: undefined }
  const items = [testIncident, low, unknown]
  expect(filterIncidents(items)).toEqual(items)
  expect(filterIncidents(items, 'High')).toEqual([testIncident, unknown])
  expect(filterIncidents(items, 'Low')).toEqual([low])
  expect(filterIncidents(items, 'Extreme')).toEqual([])
})

test('report filters retain severity and clear without the removed geography or name controls', () => {
  const props = { severity: 'Low' as const, onSeverity: vi.fn(), onClear: vi.fn() }
  const rendered = render(<ReportFilters {...props} />)
  expect(screen.getByRole('group', { name: 'Filter by severity' })).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByPlaceholderText('Filter reports by name...')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'High' }))
  expect(props.onSeverity).toHaveBeenCalledWith('High')
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(props.onClear).toHaveBeenCalledOnce()
  rendered.rerender(<ReportFilters {...props} severity="All" />)
  expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
})

test('a later low-severity approval follows high severity in both queues and marker order', async () => {
  fixtures.coordinates = {
    latitude: -41.28664,
    longitude: 174.77557,
    source: 'address',
    countryCode: 'NZ',
    region: 'Wellington',
  }
  render(<HazardWorkspace />)
  await addReport()
  await approveReport()
  await openView('Overview', 'Bushfire overview')
  fixtures.severity = 'Low'
  fixtures.coordinates = {
    latitude: -37.8136,
    longitude: 144.9631,
    source: 'address',
    countryCode: 'AU',
    region: 'Victoria',
  }
  await addReport()
  await approveReport()
  const expectQueueOrder = () => {
    const rows = within(screen.getByRole('region', { name: 'Review queue' })).getAllByRole(
      'listitem'
    )
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('High', { exact: true })).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Low', { exact: true })).toBeInTheDocument()
  }
  expectQueueOrder()
  expect(
    within(screen.getByLabelText('Test map'))
      .getAllByRole('button')
      .map((marker) => marker.getAttribute('data-testid'))
  ).toEqual(['marker-HW-001', 'marker-HW-002'])
  await openView('Overview', 'Bushfire overview')
  expectQueueOrder()
  await openView('Hazard map', 'Hazard map')
  expectQueueOrder()
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Filter by severity' })).getByRole('button', {
      name: 'Low',
    })
  )
  const filteredRows = within(screen.getByRole('region', { name: 'Review queue' })).getAllByRole(
    'listitem'
  )
  expect(filteredRows).toHaveLength(1)
  expect(within(filteredRows[0]!).getByText('Low', { exact: true })).toBeInTheDocument()
  expect(within(screen.getByLabelText('Test map')).getAllByRole('button')[0]).toHaveAttribute(
    'data-testid',
    'marker-HW-002'
  )
  expect(screen.queryByRole('combobox', { name: 'Country' })).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'State / region' })).not.toBeInTheDocument()
  expect(screen.queryByPlaceholderText('Filter reports by name...')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expectQueueOrder()
  expect(within(screen.getByLabelText('Test map')).getAllByRole('button')).toHaveLength(2)
})

test('every initial workspace view is empty and has no sample data, reset or guided tour', async () => {
  render(<HazardWorkspace />)
  for (const view of ['overview', 'map', 'reports', 'hazard', 'assistant']) {
    await setView(view)
    if (view === 'hazard') {
      expect(screen.getByText('No assessment selected')).toBeInTheDocument()
    } else {
      expect(
        within(screen.getByRole('main')).getByRole('heading', { level: 1 })
      ).toBeInTheDocument()
    }
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    expect(screen.queryByText('Katoomba ridge')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-testid^="marker-"]')).toHaveLength(0)
    expect(
      screen.queryByText(/sample data|demo workspace|fictional incident/i)
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /reset demo|walk through|start guided tour/i })
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Guided journey')).not.toBeInTheDocument()
  }
  expect(screen.getByLabelText('Ask about the selected assessment')).toBeDisabled()
  expect(fixtures.chat).not.toHaveBeenCalled()
})

test('assessed submissions stay off the map until explicit approval, use confirmed coordinates, and can be removed', async () => {
  render(<HazardWorkspace />)
  await addReport()
  await openView('Hazard map', 'Hazard map')
  expect(document.querySelectorAll('[data-testid^="marker-"]')).toHaveLength(0)
  await openView('Media reports', 'Media reports')
  expect(screen.getByText('Pending map approval')).toBeInTheDocument()
  const marker = await approveReport()
  expect(marker.getAttribute('data-testid')).toMatch(/^marker-HW-/)
  expect(marker).toHaveAttribute('data-lat', '-41.28664')
  expect(marker).toHaveAttribute('data-lng', '174.77557')
  expect(document.querySelectorAll('[data-testid^="marker-"]')).toHaveLength(1)
  await openView('Media reports', 'Media reports')
  expect(screen.getByText('Approved for map')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Map approval' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove from map' }))
  expect(screen.getByText('Pending map approval')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close media report' }))
  await openView('Hazard map', 'Hazard map')
  expect(document.querySelectorAll('[data-testid^="marker-"]')).toHaveLength(0)
  await openView('Overview', 'Bushfire overview')
  expect(screen.getByText('Locations').parentElement).toHaveTextContent('00')
  await setView('hazard')
  expect(
    screen.queryByRole('heading', { name: 'Wellington test report', level: 1 })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  await openView('Ask HazardWatch', 'Ask HazardWatch')
  expect(screen.getByLabelText('Ask about the selected assessment')).toBeDisabled()
})

test('missing or out-of-coverage coordinates keep assessed reports pending and disable map approval', async () => {
  fixtures.coordinates = undefined
  render(<HazardWorkspace />)
  await addReport()
  await openView('Media reports', 'Media reports')
  fireEvent.click(screen.getByRole('button', { name: 'Review report' }))
  expect(screen.getByRole('button', { name: 'Approve and add to map' })).toBeDisabled()
  cleanup()
  window.history.replaceState(null, '', '#overview')
  fixtures.coordinates = {
    latitude: 51.5072,
    longitude: -0.1276,
    source: 'coordinates',
  }
  render(<HazardWorkspace />)
  await addReport()
  await openView('Media reports', 'Media reports')
  fireEvent.click(screen.getByRole('button', { name: 'Review report' }))
  expect(screen.getByRole('button', { name: 'Approve and add to map' })).toBeDisabled()
})

test('clearing a pending conversation discards its late response and allows a new question', async () => {
  let resolve!: (value: { reply: string; refs: string[] }) => void
  fixtures.chat.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    })
  )
  render(<HazardWorkspace />)
  await addReport()
  await approveReport()
  await openView('Ask HazardWatch', 'Ask HazardWatch')
  fireEvent.change(screen.getByLabelText('Ask about the selected assessment'), {
    target: { value: 'First question' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  await waitFor(() => expect(fixtures.chat).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }))
  await act(async () => {
    resolve({ reply: 'Stale reply', refs: [] })
  })
  expect(screen.queryByText('Stale reply')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Ask about the selected assessment')).not.toBeDisabled()
  fixtures.chat.mockResolvedValueOnce({ reply: 'Fresh reply', refs: [] })
  fireEvent.change(screen.getByLabelText('Ask about the selected assessment'), {
    target: { value: 'New question' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  await screen.findByText('Fresh reply')
})

test('chat failure shows availability feedback without inventing an answer or evidence source', async () => {
  fixtures.chat.mockRejectedValueOnce(new Error('Chat service unavailable'))
  render(<HazardWorkspace />)
  await addReport()
  await approveReport()
  await openView('Ask HazardWatch', 'Ask HazardWatch')
  fireEvent.change(screen.getByLabelText('Ask about the selected assessment'), {
    target: { value: 'Why is this location high priority?' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Chat service unavailable')
  expect(fixtures.chat).toHaveBeenCalledTimes(1)
  const conversation = screen.getByRole('log', { name: 'Conversation' })
  expect(within(conversation).getByText('Why is this location high priority?')).toBeInTheDocument()
  expect(conversation.querySelectorAll('article')).toHaveLength(1)
  expect(within(conversation).queryByText('HazardWatchAI')).not.toBeInTheDocument()
  expect(within(conversation).queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Ask about the selected assessment')).not.toBeDisabled()
})

test('uploaded video assessments retain video evidence and their own capture date', () => {
  render(
    <ClassificationResult
      incident={{
        ...testIncident,
        name: 'Uploaded Wellington clip',
        photo: undefined,
        video: 'blob:video-evidence',
        capturedAt: '2026-10-06T11:22',
        locationSource: 'quicktime',
      }}
      onReview={() => {}}
      onAsk={() => {}}
    />
  )
  expect(screen.getByLabelText('Video evidence for Uploaded Wellington clip')).toHaveAttribute(
    'src',
    'blob:video-evidence'
  )
  expect(screen.getByText(/Captured 2026-10-06 · 11:22/)).toBeInTheDocument()
  expect(screen.queryByText('Image not available')).not.toBeInTheDocument()
  expect(screen.queryByText(/Reference photograph/)).not.toBeInTheDocument()
})

test('state names and abbreviations return an Australian state before similarly named places', () => {
  const mapApi = createRequire(import.meta.url)('../../public/prototype/map.js')
  for (const [code, name] of [
    ['NSW', 'New South Wales'],
    ['VIC', 'Victoria'],
    ['QLD', 'Queensland'],
    ['SA', 'South Australia'],
    ['WA', 'Western Australia'],
    ['TAS', 'Tasmania'],
    ['ACT', 'Australian Capital Territory'],
    ['NT', 'Northern Territory'],
  ]) {
    for (const query of [code, name, name!.toLowerCase()]) {
      const first = mapApi.searchPlaces(query)[0]
      expect(first?.place[0].replace(/^State of /, '')).toBe(name)
      expect(first?.place[2]).toBe('AU')
      expect(first?.place[5]).toBe(7)
    }
  }
})

test('the map preserves offline locations, plots actual report coordinates and selects full addresses without stale results', async () => {
  const mapApi = createRequire(import.meta.url)('../../public/prototype/map.js')
  const plots: {
    point: number[]
    icon: { className: string; html: string }
    zIndexOffset?: number
    riseOnHover?: boolean
    title?: string
    alt?: string
    events: Record<string, () => void>
    tooltip?: string
  }[] = []
  const layer = { clearLayers: vi.fn(), addTo: () => layer }
  const tileEvents: Record<string, () => void> = {}
  const tiles = {
    on: (event: string, handler: () => void) => {
      tileEvents[event] = handler
      return tiles
    },
    addTo: vi.fn(() => tiles),
  }
  const tileLayer = vi.fn(() => tiles)
  const mapEvents: Record<string, () => void> = {}
  const panes: Record<string, { style: Record<string, string | number> }> = {}
  const geoJSON = vi.fn((_data: unknown, _options: unknown) => layer)
  const fakeMap = {
    stop() {},
    fitBounds: vi.fn(),
    createPane(name: string) {
      panes[name] = { style: {} }
    },
    getPane: (name: string) => panes[name]!,
    on(event: string, handler: () => void) {
      mapEvents[event] = handler
    },
    off() {},
    remove() {},
    getCenter: () => ({ lat: -25, lng: 135 }),
    getZoom: () => 2,
    setView: vi.fn(),
    attributionControl: { addAttribution() {} },
    getBounds: () => ({
      contains: ([lat, lng]: number[]) => lat! >= -50 && lat! <= -8 && lng! >= 110 && lng! <= 190,
    }),
  }
  const originalL = Reflect.get(window, 'L')
  Reflect.set(window, 'L', {
    map: () => fakeMap,
    tileLayer,
    layerGroup: () => layer,
    geoJSON,
    circleMarker: () => ({ addTo() {} }),
    divIcon: (icon: object) => icon,
    marker: (
      point: number[],
      options: Omit<(typeof plots)[number], 'point' | 'events' | 'tooltip'>
    ) => {
      const plot: (typeof plots)[number] = { point, ...options, events: {} }
      plots.push(plot)
      const marker = {
        on: (event: string, handler: () => void) => {
          plot.events[event] = handler
          return marker
        },
        addTo: () => marker,
        bindTooltip: (tooltip: string) => {
          plot.tooltip = tooltip
          return marker
        },
      }
      return marker
    },
  })
  const container = document.createElement('div')
  document.body.append(container)
  const items = [
    {
      ...testIncident,
      id: 'SYD',
      name: 'Sydney',
      lat: -33.87,
      lng: 151.21,
      countryCode: 'AU',
      region: 'NSW',
    },
    {
      ...testIncident,
      id: 'WLG',
      name: 'Wellington',
      lat: -41.28,
      lng: 174.77,
      countryCode: 'NZ',
      region: 'Wellington',
    },
    {
      ...testIncident,
      id: 'CHT',
      name: 'Chatham',
      lat: -43.95,
      lng: -176.5,
      countryCode: 'NZ',
      region: 'Chatham Islands',
    },
    {
      ...testIncident,
      id: 'VIC',
      name: 'Melbourne',
      lat: -37.81,
      lng: 144.96,
      countryCode: 'AU',
      region: 'Victoria',
    },
    {
      ...testIncident,
      id: 'WA',
      name: 'Perth',
      lat: -31.95,
      lng: 115.86,
      countryCode: 'AU',
      region: 'Western Australia',
    },
    {
      ...testIncident,
      id: 'GPS',
      name: 'Unknown state',
      lat: -37.82,
      lng: 144.95,
      countryCode: undefined,
      region: undefined,
    },
    { ...testIncident, id: 'BAD', lat: NaN, lng: 150 },
    { ...testIncident, id: 'INFINITY', lat: -33, lng: Infinity },
    { ...testIncident, id: 'NULL', lat: null, lng: 150 },
    { ...testIncident, id: 'INVALID-LAT', lat: -91, lng: 150 },
    { ...testIncident, id: 'INVALID-LNG', lat: -33, lng: 185 },
    null,
  ]
  const order = items.flatMap((item) => (item ? [item.id] : []))
  try {
    mapApi.reset()
    container.innerHTML = mapApi.html()
    const visible = vi.fn()
    const selected = vi.fn()
    const searchAddresses = vi.fn()
    mapApi.mount({
      searchAddresses,
      items,
      order,
      onSelect: selected,
      onViewChange: visible,
    })
    const geography: {
      countries: { features: { geometry: { coordinates: number[][][][] } }[] }
      nearbyCountries: {
        features: { properties: { name: string }; geometry: { coordinates: number[][][][] } }[]
      }
    } = createRequire(import.meta.url)('../../public/prototype/assets/geography.js')
    const countryRings = geography.countries.features.flatMap((country) =>
      country.geometry.coordinates.map((polygon) =>
        polygon[0]!.map(([lng, lat]) => [lng! <= -170 ? lng! + 360 : lng!, lat!])
      )
    )
    expect(countryRings).toHaveLength(120)
    expect(countryRings.some((ring) => ring.some(([lng, lat]) => lng! > 180 && lat! < -43))).toBe(
      true
    )
    const maskCall = geoJSON.mock.calls.find(
      (call) => (call[1] as { pane?: string })?.pane === 'coverage-mask'
    )
    const mask = maskCall?.[0] as { type: string; coordinates: number[][][] } | undefined
    expect(mask?.type).toBe('Polygon')
    expect(mask?.coordinates).toHaveLength(3)
    expect(mask?.coordinates[0]).toEqual([
      [-540, -85],
      [540, -85],
      [540, 85],
      [-540, 85],
      [-540, -85],
    ])
    const coverageRings = mask!.coordinates.slice(1)
    expect(coverageRings).toEqual([
      [
        [110, -45],
        [157, -45],
        [157, -8],
        [110, -8],
        [110, -45],
      ],
      [
        [164, -50],
        [190, -50],
        [190, -29],
        [164, -29],
        [164, -50],
      ],
    ])
    const foreignCall = geoJSON.mock.calls.find(
      (call) =>
        (call[1] as { pane?: string })?.pane === 'coverage-mask' &&
        (call[0] as { type?: string })?.type === 'MultiPolygon'
    )
    const foreign = foreignCall![0] as { coordinates: number[][][][] }
    const foreignRings = foreign.coordinates.map((polygon) => polygon[0]!)
    expect(foreignRings).toHaveLength(42)
    expect(geography.nearbyCountries.features.map((feature) => feature.properties.name)).toEqual([
      'East Timor',
      'Solomon Islands',
      'Papua New Guinea',
      'Indonesia',
    ])
    const contains = (ring: number[][], [lng, lat]: number[]) => {
      let inside = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x, y] = ring[i]!
        const [previousX, previousY] = ring[j]!
        if (
          y! > lat! !== previousY! > lat! &&
          lng! < ((previousX! - x!) * (lat! - y!)) / (previousY! - y!) + x!
        )
          inside = !inside
      }
      return inside
    }
    const isVisible = (point: number[]) =>
      coverageRings.some((ring) => contains(ring, point)) &&
      !foreignRings.some((ring) => contains(ring, point))
    // Land plus offshore space keeps coastal roads and tile labels from being cut off.
    for (const point of [
      [115.4, -31.95],
      [153.35, -27.47],
      [151.4, -33.87],
      [175.1, -41.29],
      [175, -36.85],
      [183.5, -43.95],
      [144.9631, -37.8136],
    ]) {
      expect(isVisible(point)).toBe(true)
    }
    for (const point of [
      [147.18, -9.47],
      [123.9, -10],
      [125.57, -8.56],
      [160.15, -9.43],
    ]) {
      expect(isVisible(point)).toBe(false)
    }
    expect(maskCall?.[1]).toMatchObject({
      pane: 'coverage-mask',
      interactive: false,
      style: {
        stroke: false,
        fillColor: '#aad3df',
        fillOpacity: 1,
        fillRule: 'evenodd',
        smoothFactor: 0,
      },
    })
    const fallbackCall = geoJSON.mock.calls.find(
      (call) => (call[1] as { pane?: string })?.pane === 'country-outline'
    )
    const fallback = fallbackCall?.[0] as { type: string; coordinates: number[][][][] } | undefined
    expect(fallback?.type).toBe('MultiPolygon')
    expect(fallback?.coordinates).toHaveLength(countryRings.length)
    expect(
      JSON.stringify(fallback?.coordinates) === JSON.stringify(countryRings.map((ring) => [ring]))
    ).toBe(true)
    expect(panes['coverage-mask']!.style).toEqual({ zIndex: 350, pointerEvents: 'none' })
    const hazards = plots.filter((plot) => plot.icon.className.includes('hazard-marker'))
    expect(hazards.map((plot) => plot.point)).toEqual([
      [-33.87, 151.21],
      [-41.28, 174.77],
      [-43.95, 183.5],
      [-37.81, 144.96],
      [-31.95, 115.86],
      [-37.82, 144.95],
    ])
    expect(hazards.map((plot) => plot.icon.html)).toEqual([
      '<span>1</span>',
      '<span>2</span>',
      '<span>3</span>',
      '<span>4</span>',
      '<span>5</span>',
      '<span>6</span>',
    ])
    expect(visible).toHaveBeenCalledWith(['SYD', 'WLG', 'CHT', 'VIC', 'WA', 'GPS'])
    expect(hazards.map((plot) => plot.zIndexOffset)).toEqual([
      order.length,
      order.length - 1,
      order.length - 2,
      order.length - 3,
      order.length - 4,
      order.length - 5,
    ])
    expect(hazards.every((plot) => plot.riseOnHover)).toBe(true)
    const chatham = hazards[2]!
    expect(chatham.title).toContain('-43.950000, -176.500000')
    expect(chatham.alt).toContain('-43.950000, -176.500000')
    expect(chatham.tooltip).toContain('-43.950000, -176.500000')
    chatham.events.click!()
    expect(selected).toHaveBeenCalledWith('CHT')
    expect(tileLayer).toHaveBeenCalledWith(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      expect.objectContaining({
        maxZoom: 18,
        attribution: expect.stringContaining('OpenStreetMap'),
      })
    )
    expect(tiles.addTo).toHaveBeenCalledWith(fakeMap)
    const tileStatus = container.querySelector('#map-tile-status')!
    tileEvents.loading!()
    expect(tileStatus).toBeVisible()
    tileEvents.tileerror!()
    tileEvents.load!()
    expect(tileStatus).toHaveTextContent('Report markers and location search still work.')
    expect(tileStatus).toBeVisible()
    tileEvents.loading!()
    tileEvents.load!()
    expect(tileStatus).not.toBeVisible()
    mapApi.focusIncident(items[2])
    expect(fakeMap.setView).toHaveBeenCalledWith([-43.95, 183.5], 12, { animate: false })
    expect(items[2]!.lng).toBe(-176.5)
    expect(container.querySelector('[data-area-scope="blue"]')).toBeNull()
    const coverage = within(container).getByRole('group', { name: 'Map coverage' })
    expect(
      within(coverage)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Both countries', 'Australia', 'New Zealand'])
    const states = container.querySelector(
      '[aria-label="Australian states and territories"]'
    ) as HTMLElement
    expect(states).not.toBeVisible()
    expect(
      Array.from(states.querySelectorAll('[data-state-code]')).map((button) =>
        button.getAttribute('data-state-code')
      )
    ).toEqual(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'])
    fireEvent.click(within(coverage).getByRole('button', { name: 'Australia' }))
    expect(states).toBeVisible()
    expect(visible).toHaveBeenLastCalledWith(['SYD', 'VIC', 'WA', 'GPS'])
    const australiaBounds = fakeMap.fitBounds.mock.lastCall![0]
    plots.length = 0
    fireEvent.click(states.querySelector('[data-state-code="VIC"]')!)
    expect(visible).toHaveBeenLastCalledWith(['VIC'])
    expect(
      plots
        .filter((plot) => plot.icon.className.includes('hazard-marker'))
        .map((plot) => plot.point)
    ).toEqual([[-37.81, 144.96]])
    expect(
      plots
        .filter((plot) => plot.icon.className.includes('hazard-marker'))
        .map((plot) => plot.icon.html)
    ).toEqual(['<span>1</span>'])
    expect(fakeMap.fitBounds.mock.lastCall![0]).not.toEqual(australiaBounds)
    expect(container.querySelector('#selected-area-label')).toHaveTextContent('Victoria')
    expect(states.querySelector('[data-state-code="VIC"]')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(states.querySelector('[data-state-code="NSW"]')!)
    expect(visible).toHaveBeenLastCalledWith(['SYD'])
    fireEvent.click(states.querySelector('[data-state-code="WA"]')!)
    expect(visible).toHaveBeenLastCalledWith(['WA'])
    fireEvent.click(within(coverage).getByRole('button', { name: 'New Zealand' }))
    expect(states).not.toBeVisible()
    expect(visible).toHaveBeenLastCalledWith(['WLG', 'CHT'])
    fireEvent.click(within(coverage).getByRole('button', { name: 'Australia' }))
    expect(visible).toHaveBeenLastCalledWith(['SYD', 'VIC', 'WA', 'GPS'])
    expect(states.querySelector('[aria-pressed="true"]')).toBeNull()
    fireEvent.click(within(coverage).getByRole('button', { name: 'Both countries' }))
    expect(states).not.toBeVisible()
    expect(visible).toHaveBeenLastCalledWith(['SYD', 'WLG', 'CHT', 'VIC', 'WA', 'GPS'])
    const address = {
      label: '257 Test Road, Glenroy, Victoria, Australia',
      coordinates: { latitude: -37.81, longitude: 144.96, source: 'address' },
    }
    searchAddresses.mockResolvedValueOnce([address])
    const field = container.querySelector('#area-query') as HTMLInputElement
    const form = container.querySelector('#area-search-form')!
    fireEvent.input(field, { target: { value: 'Victoria' } })
    fireEvent.submit(form)
    const firstStateResult = within(
      container.querySelector('#area-results') as HTMLElement
    ).getAllByRole('button')[0]!
    expect(firstStateResult).toHaveTextContent('Victoria')
    fireEvent.click(firstStateResult)
    expect(states).toBeVisible()
    expect(visible).toHaveBeenLastCalledWith(['VIC'])
    expect(states.querySelector('[data-state-code="VIC"]')).toHaveAttribute('aria-pressed', 'true')
    expect(searchAddresses).not.toHaveBeenCalled()
    fireEvent.click(within(coverage).getByRole('button', { name: 'Both countries' }))
    fakeMap.setView.mockClear()
    for (const query of [
      '-40, 185',
      '-40, 190',
      '-91, 150',
      '51, 150',
      '-40, Infinity',
      'NaN, 150',
      '-40,',
      ', 170',
      '-40, 170, 150',
    ]) {
      expect(mapApi.parseCoordinates(query)).toBeNull()
      fireEvent.input(field, { target: { value: query } })
      fireEvent.submit(form)
      expect(container.querySelector('#area-results')).toHaveTextContent(/latitude, longitude/i)
      expect(searchAddresses).not.toHaveBeenCalled()
      expect(fakeMap.setView).not.toHaveBeenCalled()
    }
    mapApi.focusIncident(null)
    expect(fakeMap.setView).not.toHaveBeenCalled()
    expect(mapApi.parseCoordinates('-40., +170.')).toEqual({ lat: -40, lng: 170 })
    expect(mapApi.parseCoordinates('--40, 170')).toBeNull()
    fireEvent.input(field, { target: { value: '-40., +170.' } })
    fireEvent.submit(form)
    expect(fakeMap.setView).toHaveBeenCalledWith([-40, 170], 12, { animate: false })
    fireEvent.input(field, { target: { value: '-43.95, -176.5' } })
    fireEvent.submit(form)
    expect(fakeMap.setView).toHaveBeenCalledWith([-43.95, 183.5], 12, { animate: false })
    expect(container.querySelector('#selected-area-context')).toHaveTextContent(
      '-43.950000, -176.500000'
    )
    expect(searchAddresses).not.toHaveBeenCalled()
    fireEvent.input(field, { target: { value: '257 Test Road' } })
    expect(searchAddresses).not.toHaveBeenCalled()
    fireEvent.submit(form)
    const match = await within(container).findByRole('button', { name: new RegExp(address.label) })
    fireEvent.click(match)
    expect(fakeMap.setView).toHaveBeenCalledWith([-37.81, 144.96], 16, { animate: false })
    expect(container.querySelector('#selected-area-label')).toHaveTextContent(address.label)
    let resolve!: (value: (typeof address)[]) => void
    searchAddresses.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    fireEvent.input(field, { target: { value: '258 Test Road' } })
    fireEvent.submit(form)
    const signal = searchAddresses.mock.calls[1]![1] as AbortSignal
    fireEvent.click(within(container).getByRole('button', { name: /^Australia$/ }))
    expect(signal.aborted).toBe(true)
    await act(async () => resolve([address]))
    expect(container.querySelector('[data-address-index]')).toBeNull()
    fireEvent.input(field, { target: { value: 'Glenroy' } })
    fireEvent.submit(form)
    expect(searchAddresses).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-area-index]')).not.toBeNull()
    expect(mapApi.parseCoordinates('-40, -170')).toEqual({ lat: -40, lng: 190 })
    mapApi.focusIncident({ ...items[2], lng: -170 })
    expect(fakeMap.setView).toHaveBeenCalledWith([-43.95, 190], 12, { animate: false })
    fireEvent.click(within(coverage).getByRole('button', { name: 'Australia' }))
    fireEvent.click(states.querySelector('[data-state-code="VIC"]')!)
    mapEvents.dragstart!()
    mapEvents.moveend!()
    expect(visible).toHaveBeenLastCalledWith(['VIC'])
    const visibleCalls = visible.mock.calls.length
    const plotCount = plots.length
    const cameraCalls = fakeMap.setView.mock.calls.length
    mapApi.setEmergencyStations([
      { name: '<Test Fire>', kind: 'fire', latitude: -43.95312345, longitude: -176.51234567 },
      { name: 'Test Hospital 1', kind: 'hospital', latitude: -37.8136, longitude: 144.9631 },
      { name: 'Invalid station', kind: 'fire', latitude: NaN, longitude: 144 },
      { name: 'Police excluded', kind: 'police', latitude: -37.814, longitude: 144.964 },
      { name: 'Prototype excluded', kind: 'constructor', latitude: -37.814, longitude: 144.964 },
      { name: 'Ambulance excluded', kind: 'ambulance', latitude: -37.814, longitude: 144.964 },
      { name: 'Test Fire 2', kind: 'fire', latitude: -37.814, longitude: 144.964 },
      { name: 'Test Fire 3', kind: 'fire', latitude: -37.815, longitude: 144.965 },
      { name: 'Fire 4 excluded', kind: 'fire', latitude: -37.816, longitude: 144.966 },
      { name: 'Test Hospital 2', kind: 'hospital', latitude: -37.817, longitude: 144.967 },
      { name: 'Test Hospital 3', kind: 'hospital', latitude: -37.818, longitude: 144.968 },
      { name: 'Hospital 4 excluded', kind: 'hospital', latitude: -37.819, longitude: 144.969 },
    ])
    const stationPlots = plots.slice(plotCount)
    expect(stationPlots).toHaveLength(6)
    expect(stationPlots.map((plot) => plot.icon.className)).toEqual([
      'emergency-marker fire',
      'emergency-marker hospital',
      'emergency-marker fire',
      'emergency-marker fire',
      'emergency-marker hospital',
      'emergency-marker hospital',
    ])
    expect(stationPlots[0]!.point).toEqual([-43.95312345, 183.48765433])
    expect(stationPlots[0]!.tooltip).toBe('Fire station: &lt;Test Fire&gt;')
    expect(stationPlots[0]!.title).toBe('Fire station: <Test Fire>')
    expect(stationPlots[1]!.alt).toBe('Hospital: Test Hospital 1')
    expect(stationPlots.map((plot) => plot.icon.html)).toEqual([
      '<span>F1</span>',
      '<span>H1</span>',
      '<span>F2</span>',
      '<span>F3</span>',
      '<span>H2</span>',
      '<span>H3</span>',
    ])
    expect(visible).toHaveBeenCalledTimes(visibleCalls)
    expect(fakeMap.setView).toHaveBeenCalledTimes(cameraCalls)
    layer.clearLayers.mockClear()
    mapApi.setEmergencyStations([])
    expect(layer.clearLayers).toHaveBeenCalledTimes(1)
    expect(plots).toHaveLength(plotCount + 6)
    mapApi.destroy()
    container.innerHTML = mapApi.html()
    mapApi.mount({ searchAddresses, items, order, onSelect: selected, onViewChange: visible })
    const restoredStates = container.querySelector(
      '[aria-label="Australian states and territories"]'
    )!
    expect(restoredStates).toBeVisible()
    expect(restoredStates.querySelector('[data-state-code="VIC"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(container.querySelector('#selected-area-label')).toHaveTextContent('Victoria')
    expect(visible).toHaveBeenLastCalledWith(['VIC'])
  } finally {
    mapApi.reset()
    container.remove()
    Reflect.set(window, 'L', originalL)
  }
})

test('clicking an approved hazard shows directions for its own point and the assessment uses the same destination', async () => {
  render(<HazardWorkspace />)
  await addReport()
  await approveReport()
  fixtures.coordinates = { latitude: -43.95312345, longitude: -176.51234567, source: 'coordinates' }
  await openView('Overview', 'Bushfire overview')
  await addReport()
  await approveReport()
  const panel = screen.getByRole('region', { name: 'Selected hazard' })
  const google = () =>
    new URL(
      within(panel)
        .getByRole('link', { name: /Directions in Google Maps/ })
        .getAttribute('href')!
    )
  const apple = () =>
    new URL(
      within(panel)
        .getByRole('link', { name: /Directions in Apple Maps/ })
        .getAttribute('href')!
    )
  expect(google().origin).toBe('https://www.google.com')
  expect(google().searchParams.get('api')).toBe('1')
  expect(google().searchParams.get('destination')).toBe('-43.95312345,-176.51234567')
  expect(google().searchParams.has('origin')).toBe(false)
  expect(apple().origin).toBe('https://maps.apple.com')
  expect(apple().pathname).toBe('/directions')
  expect(apple().searchParams.get('destination')).toBe('-43.95312345,-176.51234567')
  expect(apple().searchParams.has('source')).toBe(false)
  expect(within(panel).getByText(/Destination:/)).toHaveTextContent('-43.953123, -176.512346')
  for (const link of within(panel).getAllByRole('link')) {
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  }
  fireEvent.click(screen.getByTestId('marker-HW-001'))
  expect(google().searchParams.get('destination')).toBe('-41.28664,174.77557')
  expect(apple().searchParams.get('destination')).toBe('-41.28664,174.77557')
  fireEvent.click(within(panel).getByRole('button', { name: /Inspect evidence/ }))
  await screen.findByRole('heading', { name: 'Wellington test report', level: 1 })
  const assessmentLink = screen.getByRole('link', { name: /Directions in Google Maps/ })
  expect(new URL(assessmentLink.getAttribute('href')!).searchParams.get('destination')).toBe(
    '-41.28664,174.77557'
  )
})

test('directions reject invalid coordinates and preserve valid zero coordinates', () => {
  const rendered = render(<HazardDirections incident={{ ...testIncident, lat: 0, lng: 0 }} />)
  expect(
    new URL(
      screen.getByRole('link', { name: /Google Maps/ }).getAttribute('href')!
    ).searchParams.get('destination')
  ).toBe('0,0')
  for (const point of [
    { lat: NaN, lng: 150 },
    { lat: -33, lng: Infinity },
    { lat: -91, lng: 150 },
    { lat: -33, lng: 181 },
  ]) {
    rendered.rerender(<HazardDirections incident={{ ...testIncident, ...point }} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  }
})

test('selecting an approved hazard shows three hospitals and three fire stations beneath the map', async () => {
  const stations = (['hospital', 'fire'] as const).flatMap((kind, group) =>
    [1, 2, 3].map((index) => ({
      id: `node/${group * 3 + index}`,
      name: `Test Wellington ${kind} ${index}`,
      kind,
      latitude: -41.29 - index * 0.001,
      longitude: 174.78,
      distanceKm: index * 0.5,
      address: 'Test Street',
      phone: '',
      website: '',
      emergencyDepartment: 'unknown',
    }))
  )
  fixtures.stationsLookup.mockResolvedValue(stations)
  render(<HazardWorkspace />)
  await addReport()
  await approveReport()
  fireEvent.click(screen.getByTestId('marker-HW-001'))
  await screen.findByText('F1. Test Wellington fire 1')
  expect(fixtures.stationsLookup).toHaveBeenLastCalledWith(
    { latitude: -41.28664, longitude: 174.77557 },
    expect.any(AbortSignal)
  )
  expect(screen.getByLabelText('Test map')).toHaveAttribute('data-station-count', '6')
  expect(within(screen.getByLabelText('Test map')).getAllByRole('button')).toHaveLength(1)
  const beneath = screen.getByRole('region', { name: 'Emergency services beneath the map' })
  const nearest = within(beneath).getByRole('region', { name: 'Nearby emergency services' })
  for (const name of ['Closest 3 hospitals', 'Closest 3 fire stations']) {
    expect(
      within(within(nearest).getByRole('region', { name })).getAllByRole('listitem')
    ).toHaveLength(3)
  }
  expect(
    within(screen.getByRole('region', { name: 'Selected hazard' })).queryByRole('region', {
      name: 'Nearby emergency services',
    })
  ).not.toBeInTheDocument()
  const first = within(nearest).getAllByRole('link', { name: /Directions in Google Maps/ })[0]!
  expect(new URL(first.getAttribute('href')!).searchParams.get('destination')).toBe(
    `${stations[0]!.latitude},174.78`
  )
  await openView('Overview', 'Bushfire overview')
  await openView('Hazard map', 'Hazard map')
  expect(screen.getByLabelText('Test map')).toHaveAttribute('data-station-count', '0')
})

test('emergency services stay tied to the selected hazard outside the map viewport until another hazard is selected', async () => {
  fixtures.stationsLookup.mockImplementation(({ latitude }: { latitude: number }) =>
    Promise.resolve([
      {
        id: latitude === -41.28664 ? 'node/1001' : 'node/1002',
        name:
          latitude === -41.28664 ? 'Test Wellington Fire Station' : 'Test Melbourne Fire Station',
        kind: 'fire',
        latitude,
        longitude: latitude === -41.28664 ? 174.77557 : 144.9631,
        distanceKm: 0.5,
        address: '',
        phone: '',
        website: '',
        emergencyDepartment: 'unknown',
      },
    ])
  )
  render(<HazardWorkspace />)
  await addReport()
  await approveReport()
  await openView('Overview', 'Bushfire overview')
  fixtures.coordinates = { latitude: -37.8136, longitude: 144.9631, source: 'coordinates' }
  await addReport()
  await approveReport()
  fireEvent.click(screen.getByTestId('marker-HW-001'))
  await screen.findByText('F1. Test Wellington Fire Station')

  const lookupCalls = fixtures.stationsLookup.mock.calls.length
  const expectWellingtonSelected = () => {
    expect(fixtures.stationsLookup).toHaveBeenLastCalledWith(
      { latitude: -41.28664, longitude: 174.77557 },
      expect.any(AbortSignal)
    )
    expect(fixtures.stationsLookup).toHaveBeenCalledTimes(lookupCalls)
    expect(screen.getByLabelText('Test map')).toHaveAttribute('data-station-count', '1')
    expect(
      within(screen.getByRole('region', { name: 'Emergency services beneath the map' })).getByText(
        'F1. Test Wellington Fire Station'
      )
    ).toBeInTheDocument()
    const directions = within(screen.getByRole('region', { name: 'Selected hazard' })).getByRole(
      'link',
      { name: /Directions in Google Maps/ }
    )
    expect(new URL(directions.getAttribute('href')!).searchParams.get('destination')).toBe(
      '-41.28664,174.77557'
    )
  }
  expectWellingtonSelected()
  expect(fixtures.mapVisible).toBeTypeOf('function')
  act(() => fixtures.mapVisible!(['HW-002']))
  expect(
    within(screen.getByRole('region', { name: 'Review queue' })).getAllByRole('listitem')
  ).toHaveLength(1)
  expectWellingtonSelected()
  act(() => fixtures.mapVisible!([]))
  expect(screen.getByText('No reports in this view')).toBeInTheDocument()
  expectWellingtonSelected()

  fireEvent.click(screen.getByTestId('marker-HW-002'))
  await screen.findByText('F1. Test Melbourne Fire Station')
  expect(fixtures.stationsLookup).toHaveBeenLastCalledWith(
    { latitude: -37.8136, longitude: 144.9631 },
    expect.any(AbortSignal)
  )
  expect(fixtures.stationsLookup).toHaveBeenCalledTimes(lookupCalls + 1)
  expect(screen.queryByText('F1. Test Wellington Fire Station')).not.toBeInTheDocument()
  const directions = within(screen.getByRole('region', { name: 'Selected hazard' })).getByRole(
    'link',
    { name: /Directions in Google Maps/ }
  )
  expect(new URL(directions.getAttribute('href')!).searchParams.get('destination')).toBe(
    '-37.8136,144.9631'
  )
})
