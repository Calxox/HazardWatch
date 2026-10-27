'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { LayoutDashboard, Map, Images, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  filterIncidents,
  sortIncidentsBySeverity,
  approvalError,
  reportToIncident,
  viewLabels,
  type Incident,
  type Message,
  type Report,
  type SeverityFilter,
  type View,
} from '@/features/hazardwatch/model'
import {
  chatAboutAssessment,
  incidentToCard,
  incidentToSeverityJson,
} from '@/features/hazardwatch/api'
import type { EmergencyStation } from '@/features/hazardwatch/emergency-services'
import { HazardMap } from './HazardMap'
import { NearbyEmergencyServices } from './EmergencyServices'
import { ClassificationResult } from './ClassificationResult'
import { ImageUpload, ReportPreview } from './ImageUpload'
import { AssistantScreen, Overview, PriorityList, ReportFilters, ReportsScreen } from './Screens'
import { Modal, ScreenHeader } from './ui'

const navigation = [
  ['overview', LayoutDashboard],
  ['map', Map],
  ['reports', Images],
  ['assistant', MessageSquare],
] as const
function subscribeView(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}
function readView(): View {
  const value = window.location.hash.slice(1)
  return Object.hasOwn(viewLabels, value) ? (value as View) : 'overview'
}
function navigate(view: View) {
  window.location.hash = view
}

export function HazardWorkspace() {
  const view = useSyncExternalStore(subscribeView, readView, () => 'overview' as View)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [emergencyStations, setEmergencyStations] = useState<EmergencyStation[]>([])
  const [severity, setSeverity] = useState<SeverityFilter>('All')
  const [visibleIds, setVisibleIds] = useState<string[] | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [uploadOpen, setUploadOpen] = useState(false)
  const [previewReport, setPreviewReport] = useState<Report | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [mapFocusId, setMapFocusId] = useState<string | null>(null)
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')
  const nextReport = useRef(1)
  const lastSubmittedId = useRef('')
  const chatGeneration = useRef({ value: 0 })
  const objectUrls = useRef(new Set<string>())
  const main = useRef<HTMLElement>(null)
  const filtered = useMemo(() => filterIncidents(incidents, severity), [incidents, severity])
  const visible =
    visibleIds === null ? filtered : filtered.filter((item) => visibleIds.includes(item.id))
  const selected = incidents.find((item) => item.id === selectedId) ?? incidents[0]
  const currentPreview = previewReport
    ? (reports.find((report) => report.id === previewReport.id) ?? previewReport)
    : null

  useEffect(() => {
    document.title = `${viewLabels[view]} · HazardWatch`
    main.current?.focus({ preventScroll: true })
  }, [view])
  useEffect(() => {
    const urls = objectUrls.current
    const generation = chatGeneration.current
    return () => {
      generation.value++
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [])
  const selectIncident = useCallback((id: string) => setSelectedId(id), [])
  const onVisible = useCallback((ids: string[]) => setVisibleIds(ids), [])
  function inspect(id: string) {
    const report = reports.find((item) => item.id === id)
    if (report && !report.approved) {
      setPreviewReport(report)
      navigate('reports')
      return
    }
    setSelectedId(id)
    navigate('hazard')
    window.scrollTo(0, 0)
  }
  function clearFilters() {
    setSeverity('All')
    setVisibleIds(null)
    setResetKey((value) => value + 1)
    setMapFocusId(null)
  }
  function clearConversation() {
    chatGeneration.current.value++
    setMessages([])
    setChatBusy(false)
    setChatError('')
  }
  async function ask(question: string) {
    const text = question.trim().slice(0, 500)
    if (!text || chatBusy) return
    navigate('assistant')
    const current = incidents.find((item) => item.id === selectedId) ?? incidents[0]
    if (!current) {
      setChatError('Submit and approve an assessed report before asking about its evidence.')
      return
    }
    const history = messages.map((m) => ({ role: m.role, content: m.text }))
    const board = incidents.map(incidentToCard)
    const generation = ++chatGeneration.current.value
    setMessages((prev) => [...prev, { role: 'user', text }])
    setChatBusy(true)
    setChatError('')
    try {
      const severityJson = incidentToSeverityJson(current)
      const { reply, refs } = await chatAboutAssessment(
        text,
        severityJson,
        history,
        board,
        current?.id
      )
      if (generation !== chatGeneration.current.value) return
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: reply,
          refs: refs.filter((id) => incidents.some((item) => item.id === id)),
        },
      ])
    } catch (err) {
      if (generation !== chatGeneration.current.value) return
      setChatError(
        err instanceof Error
          ? `The assistant service is unavailable: ${err.message}`
          : 'The assistant service is unavailable. Please try again.'
      )
    } finally {
      if (generation === chatGeneration.current.value) setChatBusy(false)
    }
  }
  function addReport(report: Omit<Report, 'id'>) {
    const id = `HW-${String(nextReport.current++).padStart(3, '0')}`
    if (report.preview.startsWith('blob:')) objectUrls.current.add(report.preview)
    const withId = { ...report, id, approved: false }
    lastSubmittedId.current = id
    setReports((current) => [withId, ...current])
    return id
  }
  function approveReport(report: Report) {
    const problem = approvalError(report)
    const incident = reportToIncident({ ...report, approved: true })
    if (problem || !incident) {
      toast.error(problem || 'Check the assessment and location before approval.')
      return
    }
    setReports((current) =>
      current.map((item) => (item.id === report.id ? { ...item, approved: true } : item))
    )
    setIncidents((current) =>
      current.some((item) => item.id === incident.id)
        ? current
        : sortIncidentsBySeverity([incident, ...current])
    )
    clearFilters()
    setSelectedId(incident.id)
    setMapFocusId(incident.id)
    setPreviewReport(null)
    navigate('map')
    toast.success('Report approved and added at its confirmed location.')
  }
  function removeFromMap(report: Report) {
    setReports((current) =>
      current.map((item) => (item.id === report.id ? { ...item, approved: false } : item))
    )
    setIncidents((current) => current.filter((item) => item.id !== report.id))
    if (selectedId === report.id) {
      setSelectedId(incidents.find((item) => item.id !== report.id)?.id ?? '')
      clearConversation()
    }
    setMapFocusId(null)
    toast.success('Removed from the map. The report remains in the register.')
  }

  return (
    <div className="hw-app">
      <a
        href="#hw-main"
        className="hw-skip"
        onClick={(event) => {
          event.preventDefault()
          main.current?.focus()
        }}
      >
        Skip to content
      </a>
      <aside className="hw-sidebar">
        <a href="#overview" className="hw-brand" aria-label="HazardWatch overview">
          <img src="/prototype/assets/hazard-watch-logo.png" alt="" width={34} height={34} />
          <span>
            HazardWatch<small>FIELD INTELLIGENCE</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {navigation.map(([key, Icon]) => (
            <a
              key={key}
              href={`#${key}`}
              aria-label={viewLabels[key]}
              aria-current={
                view === key || (key === 'map' && view === 'hazard') ? 'page' : undefined
              }
            >
              <Icon size={20} />
              <span>{viewLabels[key]}</span>
              {key === 'reports' && reports.length > 0 && <b>{reports.length}</b>}
            </a>
          ))}
        </nav>
      </aside>
      <div className="hw-workspace">
        <header className="hw-topbar">
          <span>Workspace / {viewLabels[view]}</span>
        </header>
        <main id="hw-main" ref={main} tabIndex={-1}>
          <ErrorBoundary>
            {view === 'overview' && (
              <Overview
                items={incidents}
                reportCount={reports.length}
                selectedId={selectedId}
                onSelect={selectIncident}
                onInspect={inspect}
                onUpload={() => setUploadOpen(true)}
              />
            )}
            {view === 'map' && (
              <>
                <ScreenHeader
                  title="Hazard map"
                  description="Explore an area, narrow the reports, and inspect the evidence."
                />
                <ReportFilters
                  severity={severity}
                  onSeverity={(level) => {
                    setSeverity(level)
                    setVisibleIds(null)
                  }}
                  onClear={clearFilters}
                />
                <div className="hw-map-grid">
                  <div className="hw-map-column">
                    <HazardMap
                      items={filtered}
                      onSelect={selectIncident}
                      onVisible={onVisible}
                      resetKey={resetKey}
                      focusId={mapFocusId}
                      stations={emergencyStations}
                    />
                    <section
                      className="hw-panel hw-map-services"
                      aria-label="Emergency services beneath the map"
                    >
                      <h2>Emergency services near the selected hazard</h2>
                      {selected ? (
                        <>
                          <p className="hw-note">{selected.name}</p>
                          <NearbyEmergencyServices
                            key={selected.id}
                            latitude={selected.lat}
                            longitude={selected.lng}
                            onStations={setEmergencyStations}
                          />
                        </>
                      ) : (
                        <p className="hw-note">
                          Select an approved hazard to find the closest 3 hospitals and 3 fire
                          stations.
                        </p>
                      )}
                    </section>
                  </div>
                  <PriorityList
                    items={visible}
                    selectedId={selectedId}
                    selectedIncident={selected}
                    onSelect={selectIncident}
                    onInspect={inspect}
                    onClear={clearFilters}
                  />
                </div>
                <p className="hw-note">
                  Reports appear after their location and assessment are approved for the map.
                </p>
              </>
            )}
            {view === 'hazard' &&
              (selected ? (
                <ClassificationResult
                  incident={selected}
                  onReview={() => {
                    setIncidents((current) =>
                      current.map((item) =>
                        item.id === selected.id ? { ...item, reviewed: !item.reviewed } : item
                      )
                    )
                    toast.success(
                      selected.reviewed
                        ? 'Review mark removed.'
                        : 'Marked as reviewed in this session.'
                    )
                  }}
                  onAsk={() => ask(`Why is ${selected.name} prioritised?`)}
                />
              ) : (
                <EmptyState
                  title="No assessment selected"
                  description="Submit media and approve its assessment to review it here."
                  action={
                    <button className="hw-button" onClick={() => setUploadOpen(true)}>
                      Submit media
                    </button>
                  }
                />
              ))}
            {view === 'reports' && (
              <ReportsScreen
                incidents={incidents}
                reports={reports}
                onUpload={() => setUploadOpen(true)}
                onInspect={inspect}
                onPreview={setPreviewReport}
              />
            )}
            {view === 'assistant' && (
              <AssistantScreen
                messages={messages}
                items={incidents}
                busy={chatBusy}
                unavailableReason={chatError}
                onAsk={(q) => void ask(q)}
                onInspect={inspect}
                onClear={clearConversation}
              />
            )}
          </ErrorBoundary>
        </main>
        <footer className="hw-footer">HazardWatch · Human review required</footer>
      </div>
      {uploadOpen && (
        <ImageUpload
          onClose={() => setUploadOpen(false)}
          onSubmit={addReport}
          onViewReport={() => {
            setUploadOpen(false)
            navigate('reports')
            const report = reports.find((item) => item.id === lastSubmittedId.current)
            if (report) setPreviewReport(report)
          }}
        />
      )}
      {currentPreview && (
        <Modal title="Media report" onClose={() => setPreviewReport(null)}>
          <div className="hw-modal-body">
            <ReportPreview report={currentPreview} />
            <p className="hw-note">
              {currentPreview.approved
                ? 'Approved for the map at the confirmed coordinates. This is separate from dispatch approval.'
                : 'Pending map approval. Review the evidence, assessment and confirmed location before adding it to the map.'}
            </p>
            {!currentPreview.approved && approvalError(currentPreview) && (
              <p className="hw-error" role="status">
                {approvalError(currentPreview)}
              </p>
            )}
            {currentPreview.approved ? (
              <div className="hw-actions">
                <button
                  className="hw-button hw-secondary"
                  onClick={() => removeFromMap(currentPreview)}
                >
                  Remove from map
                </button>
                <button
                  className="hw-button"
                  onClick={() => {
                    setSelectedId(currentPreview.id)
                    setPreviewReport(null)
                    navigate('hazard')
                  }}
                >
                  Open assessment
                </button>
              </div>
            ) : (
              <div className="hw-actions">
                <button
                  className="hw-button"
                  disabled={Boolean(approvalError(currentPreview))}
                  onClick={() => approveReport(currentPreview)}
                >
                  Approve and add to map
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
