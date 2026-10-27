import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { ImageUpload } from '@/features/hazardwatch/components/ImageUpload'
import { reportSchema, type Report } from '@/features/hazardwatch/model'
import { captureTimeNow } from '@/features/hazardwatch/location'
import type { MediaLocationMetadata, SeverityJson } from '@/features/hazardwatch/api'

const service = vi.hoisted(() => ({ assess: vi.fn(), metadata: vi.fn() }))
vi.mock('@/features/hazardwatch/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assessMedia: service.assess,
  readMediaLocation: service.metadata,
}))

const assessment: SeverityJson = {
  input_type: 'image',
  severity: 'high',
  severity_confidence: 0.85,
  severity_index: 3,
  key_features: ['actual_flames'],
  key_feature_scores: { actual_flames: 0.9 },
  explainability_note: 'Flames visible; extent uncertain.',
  modality: 'ground',
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  service.assess.mockReset().mockResolvedValue(assessment)
  service.metadata.mockReset().mockResolvedValue({
    status: 'missing',
    latitude: null,
    longitude: null,
    source: null,
    detail: 'No GPS metadata.',
  })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No network in upload tests')))
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      decode = vi.fn().mockResolvedValue(undefined)
    }
  )
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = vi.fn(() => 'blob:test-evidence')
      static override revokeObjectURL = vi.fn()
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function chooseMedia() {
  const file = new File([Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)], 'test-evidence.jpg', {
    type: 'image/jpeg',
  })
  await userEvent.setup().upload(screen.getByLabelText('Choose media'), file)
  await waitFor(() => expect(service.metadata).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Add context' }))
  return file
}
function applyCoordinates() {
  fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '-33.713' } })
  fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '150.311' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply coordinates' }))
}
function review() {
  fireEvent.submit(screen.getByRole('button', { name: 'Review report' }).closest('form')!)
}

test('submission validates context, preserves edits and assesses once while awaiting map approval', async () => {
  const submit = vi.fn<(report: Omit<Report, 'id'>) => string>(() => 'HW-001')
  render(<ImageUpload onClose={() => {}} onSubmit={submit} onViewReport={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add context' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/Choose an image.*video/)
  expect(screen.queryByRole('button', { name: 'Use example image' })).not.toBeInTheDocument()
  const file = await chooseMedia()
  fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: '   ' } })
  review()
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a location')
  fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: ' Katoomba lookout ' } })
  review()
  expect(screen.getByRole('alert')).toHaveTextContent('Confirm capture coordinates')
  applyCoordinates()
  const captureTime = captureTimeNow()
  for (const date of ['2026-02-30T12:00', '2050-01-01T12:00']) {
    fireEvent.change(screen.getByLabelText(/Captured at/), { target: { value: date } })
    review()
    expect(screen.getByRole('alert')).toHaveTextContent(/capture time/)
    expect(
      reportSchema.safeParse({
        location: 'Katoomba lookout',
        date,
        source: 'Ground/Citizen',
        notes: '',
      }).success
    ).toBe(false)
  }
  fireEvent.change(screen.getByLabelText(/Captured at/), { target: { value: captureTime } })
  fireEvent.change(screen.getByLabelText(/Field notes/), {
    target: { value: 'Smoke visible; extent uncertain.' },
  })
  review()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByLabelText(/^Location/)).toHaveValue('Katoomba lookout')
  expect(screen.getByLabelText(/Field notes/)).toHaveValue('Smoke visible; extent uncertain.')
  fireEvent.change(screen.getByLabelText(/Field notes/), {
    target: { value: '  Edited evidence notes.  ' },
  })
  review()
  const assess = screen.getByRole('button', { name: 'Assess severity' })
  fireEvent.click(assess)
  fireEvent.click(assess)
  await screen.findByText('Awaiting approval for the map.')
  expect(service.assess).toHaveBeenCalledTimes(1)
  expect(service.metadata).toHaveBeenCalledWith(file, expect.any(AbortSignal))
  expect(service.assess).toHaveBeenCalledWith(file, 'image', 'ground', expect.any(AbortSignal))
  expect(fetch).not.toHaveBeenCalled()
  expect(submit).toHaveBeenCalledTimes(1)
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      location: 'Katoomba lookout',
      notes: 'Edited evidence notes.',
      preview: 'blob:test-evidence',
      mediaType: 'image',
      coordinates: { latitude: -33.713, longitude: 150.311, source: 'coordinates' },
      assessment: expect.objectContaining({ severity: 'High', confidence: 85 }),
    })
  )
  const report = submit.mock.calls[0]![0]
  expect(report.approved).not.toBe(true)
  expect(reportSchema.safeParse(report).success).toBe(true)
})

test('closing during assessment aborts the request and a late response cannot create a report', async () => {
  let resolve!: (result: SeverityJson) => void
  service.assess.mockReturnValueOnce(
    new Promise<SeverityJson>((done) => {
      resolve = done
    })
  )
  const submit = vi.fn<(report: Omit<Report, 'id'>) => string>(() => 'HW-002')
  const close = vi.fn()
  const rendered = render(<ImageUpload onClose={close} onSubmit={submit} onViewReport={() => {}} />)
  await chooseMedia()
  fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: 'Katoomba lookout' } })
  applyCoordinates()
  review()
  fireEvent.click(screen.getByRole('button', { name: 'Assess severity' }))
  await waitFor(() => expect(service.assess).toHaveBeenCalledTimes(1))
  const signal = service.assess.mock.calls[0]![3] as AbortSignal
  fireEvent.click(screen.getByRole('button', { name: 'Close submit media' }))
  expect(close).toHaveBeenCalledTimes(1)
  rendered.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => {
    resolve(assessment)
  })
  expect(submit).not.toHaveBeenCalled()
})

test('a metadata service failure still allows manual location entry for video', async () => {
  service.metadata.mockRejectedValueOnce(new Error('Metadata service offline'))
  render(<ImageUpload onClose={() => {}} onSubmit={() => 'HW-003'} onViewReport={() => {}} />)
  const file = new File(['video'], 'evidence.mp4', { type: 'video/mp4' })
  await userEvent.setup().upload(screen.getByLabelText('Choose media'), file)
  await waitFor(() => expect(service.metadata).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Add context' }))
  await screen.findByText(/The local metadata service is unavailable/)
  fireEvent.change(screen.getByLabelText(/^Location/), {
    target: { value: 'Manual video location' },
  })
  applyCoordinates()
  review()
  expect(screen.getByRole('heading', { name: 'Check your report' })).toBeInTheDocument()
  expect(service.assess).not.toHaveBeenCalled()
})

test.each([
  'Invalid location metadata. Enter a location manually.',
  'Invalid coordinates in media metadata. Enter a location manually.',
])('invalid metadata shows its reason and allows manual continuation: %s', async (message) => {
  service.metadata.mockRejectedValueOnce(new Error(message))
  render(<ImageUpload onClose={() => {}} onSubmit={() => 'HW-INVALID'} onViewReport={() => {}} />)
  await chooseMedia()
  await screen.findByText(new RegExp(message.replaceAll('.', '\\.')))
  expect(screen.queryByRole('button', { name: 'Use location from media' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(/^Location/), {
    target: { value: 'Confirmed capture point' },
  })
  applyCoordinates()
  review()
  expect(screen.getByRole('heading', { name: 'Check your report' })).toBeInTheDocument()
})

test('malformed metadata JSON shows a safe fallback rather than parser output', async () => {
  service.metadata.mockRejectedValueOnce(new SyntaxError('Unexpected token < in private response'))
  render(<ImageUpload onClose={() => {}} onSubmit={() => 'HW-JSON'} onViewReport={() => {}} />)
  await chooseMedia()
  await screen.findByText(/The local metadata service is unavailable/)
  expect(screen.queryByText(/private response/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Apply coordinates' })).toBeInTheDocument()
})

test('metadata from replaced media cannot overwrite its replacement or a manual location', async () => {
  let resolve!: (value: MediaLocationMetadata) => void
  service.metadata.mockReturnValueOnce(
    new Promise<MediaLocationMetadata>((done) => {
      resolve = done
    })
  )
  const current: MediaLocationMetadata = {
    status: 'found',
    latitude: -41.2866,
    longitude: 174.7756,
    source: 'quicktime',
    detail: 'Video GPS found.',
  }
  service.metadata.mockResolvedValueOnce(current)
  render(<ImageUpload onClose={() => {}} onSubmit={() => 'HW-REPLACED'} onViewReport={() => {}} />)
  const first = new File(['old'], 'old.mp4', { type: 'video/mp4' })
  const second = new File(['new'], 'new.mov', { type: 'video/quicktime' })
  const user = userEvent.setup()
  await user.upload(screen.getByLabelText('Choose media'), first)
  await waitFor(() => expect(service.metadata).toHaveBeenCalledTimes(1))
  const oldSignal = service.metadata.mock.calls[0]![1] as AbortSignal
  await user.upload(screen.getByLabelText('Change media'), second)
  await waitFor(() => expect(service.metadata).toHaveBeenCalledTimes(2))
  expect(oldSignal.aborted).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Add context' }))
  await screen.findByText(/Video location metadata: -41.286600, 174.775600/)
  fireEvent.change(screen.getByLabelText(/^Location/), {
    target: { value: 'Manual capture point' },
  })
  applyCoordinates()
  await act(async () =>
    resolve({
      status: 'found',
      latitude: -37.81,
      longitude: 144.96,
      source: 'exif',
      detail: 'Old GPS found.',
    })
  )
  expect(screen.queryByText(/Image GPS metadata:/)).not.toBeInTheDocument()
  expect(screen.getByText(/Video location metadata:/)).toBeInTheDocument()
  expect(screen.getByLabelText(/^Location/)).toHaveValue('Manual capture point')
  expect(screen.getByText(/Location confirmed:/).closest('p')).toHaveTextContent(
    '-33.713000, 150.311000'
  )
  review()
  expect(screen.getByRole('heading', { name: 'Check your report' })).toBeInTheDocument()
})
