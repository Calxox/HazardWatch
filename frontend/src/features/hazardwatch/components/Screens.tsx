'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ImagePlus, Send } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  type Incident,
  type Message,
  type Report,
  type SeverityFilter,
} from '@/features/hazardwatch/model'
import { ScreenHeader, SeverityBadge, RichText } from './ui'
import { HazardDirections } from './HazardDirections'
import { EmergencyServiceFinder } from './EmergencyServices'

export function PriorityList({
  items,
  selectedId,
  selectedIncident,
  onSelect,
  onInspect,
  onClear,
}: {
  items: Incident[]
  selectedId: string
  selectedIncident?: Incident
  onSelect: (id: string) => void
  onInspect: (id: string) => void
  onClear?: () => void
}) {
  const selected = selectedIncident ?? items.find((item) => item.id === selectedId) ?? items[0]
  return (
    <section className="hw-panel hw-priority" aria-label="Review queue">
      <div className="hw-section-heading">
        <h2>Review queue</h2>
        <span className="hw-muted">{items.length} locations</span>
      </div>
      {items.length ? (
        <ol>
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                className="hw-priority-row"
                aria-pressed={selected?.id === item.id}
                onClick={() => onSelect(item.id)}
              >
                <span className="hw-rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="hw-priority-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.images} {item.video ? 'sampled frames' : 'images'} · {item.time}
                    {item.reviewed && (
                      <span className="hw-reviewed">
                        <Check size={12} /> Reviewed
                      </span>
                    )}
                  </small>
                </span>
                <SeverityBadge severity={item.severity} />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title="No reports in this view"
          description={
            onClear
              ? 'Try another area or clear the report filters.'
              : 'Submit media and approve its confirmed location to add it to the review queue.'
          }
          action={
            onClear && (
              <button className="hw-button hw-secondary" onClick={onClear}>
                Clear filters
              </button>
            )
          }
        />
      )}
      {selected && (
        <div className="hw-selection" role="region" aria-label="Selected hazard">
          <h3>{selected.name}</h3>
          {!items.some((item) => item.id === selected.id) && (
            <p className="hw-note">The selected hazard is outside the current view.</p>
          )}
          <p>
            <RichText text={selected.explainability || selected.reason} />
          </p>
          <HazardDirections incident={selected} />
          <button className="hw-text-button" onClick={() => onInspect(selected.id)}>
            Inspect evidence <ArrowRight size={16} />
          </button>
        </div>
      )}
    </section>
  )
}

export function Overview({
  items,
  reportCount,
  selectedId,
  onSelect,
  onInspect,
  onUpload,
}: {
  items: Incident[]
  reportCount: number
  selectedId: string
  onSelect: (id: string) => void
  onInspect: (id: string) => void
  onUpload: () => void
}) {
  const metrics = [
    ['Locations', items.length],
    [
      'High + extreme',
      items.filter((item) => item.severity === 'High' || item.severity === 'Extreme').length,
    ],
    ['Awaiting review', items.filter((item) => !item.reviewed).length],
    ['Media reports', reportCount],
  ] as const
  return (
    <>
      <ScreenHeader
        title="Bushfire overview"
        description="Find what needs attention, then review the evidence."
        action={
          <button className="hw-button" onClick={onUpload}>
            <ImagePlus size={18} /> Submit media
          </button>
        }
      />
      <EmergencyServiceFinder />
      {(reportCount > 0 || items.length > 0) && (
        <section className="hw-metrics" aria-label="Incident summary">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{String(value).padStart(2, '0')}</strong>
            </div>
          ))}
        </section>
      )}
      {items.length > 0 ? (
        <PriorityList
          items={items}
          selectedId={selectedId}
          onSelect={onSelect}
          onInspect={onInspect}
        />
      ) : (
        <section className="hw-panel">
          <EmptyState
            title="No approved reports yet"
            description="Submit an image or video, assess it, and approve its location to add it to the map."
          />
        </section>
      )}
    </>
  )
}

export function ReportFilters({
  severity,
  onSeverity,
  onClear,
}: {
  severity: SeverityFilter
  onSeverity: (level: SeverityFilter) => void
  onClear: () => void
}) {
  return (
    <div className="hw-filters">
      <div className="hw-filter-levels" role="group" aria-label="Filter by severity">
        {(['All', 'Extreme', 'High', 'Moderate', 'Low', 'None'] as const).map((level) => (
          <button key={level} aria-pressed={severity === level} onClick={() => onSeverity(level)}>
            {level}
          </button>
        ))}
      </div>
      {severity !== 'All' && (
        <button className="hw-text-button" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  )
}

export function ReportsScreen({
  incidents,
  reports,
  onUpload,
  onInspect,
  onPreview,
}: {
  incidents: Incident[]
  reports: Report[]
  onUpload: () => void
  onInspect: (id: string) => void
  onPreview: (report: Report) => void
}) {
  const reviewedIds = new Set(incidents.filter((item) => item.reviewed).map((item) => item.id))

  return (
    <>
      <ScreenHeader
        title="Media reports"
        description="Keep evidence and its context together for review."
        action={
          <button className="hw-button" onClick={onUpload}>
            <ImagePlus size={18} /> Submit media
          </button>
        }
      />
      {!reports.length && (
        <section className="hw-panel">
          <EmptyState
            title="No media reports yet"
            description="Submit an image or video to assess its severity and confirm its location."
          />
        </section>
      )}
      {reports.length > 0 && (
        <div
          className="hw-panel hw-table-wrap"
          role="region"
          aria-label="Report register"
          tabIndex={0}
        >
          <table>
            <caption className="hw-sr-only">Uploaded media reports and map approval status</caption>
            <thead>
              <tr>
                <th>Report / location</th>
                <th>Source & capture time</th>
                <th>Assessment</th>
                <th>Review</th>
                <th>
                  <span className="hw-sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>
                    <strong>{report.location}</strong>
                    <small>
                      {report.id} · {report.mediaType}
                    </small>
                  </td>
                  <td>
                    {report.source}
                    <small>{report.date.replace('T', ' · ')} · Sydney time</small>
                  </td>
                  <td>
                    <SeverityBadge severity={report.assessment?.severity ?? 'Unassessed'} />
                  </td>
                  <td>
                    {report.approved
                      ? reviewedIds.has(report.id)
                        ? 'Approved for map · reviewed'
                        : 'Approved for map'
                      : report.assessment
                        ? 'Pending map approval'
                        : 'Awaiting assessment'}
                  </td>
                  <td>
                    {report.approved && (
                      <button className="hw-text-button" onClick={() => onInspect(report.id)}>
                        Inspect <ArrowRight size={15} />
                      </button>
                    )}
                    <button className="hw-text-button" onClick={() => onPreview(report)}>
                      {report.approved ? 'Map approval' : 'Review report'} <ArrowRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hw-note">
        Pending reports stay in this register until approved for the map. Reloading clears unsaved
        reports.
      </p>
    </>
  )
}

export function AssistantScreen({
  messages,
  items,
  busy = false,
  unavailableReason,
  onAsk,
  onInspect,
  onClear,
}: {
  messages: Message[]
  items: Incident[]
  busy?: boolean
  unavailableReason?: string
  onAsk: (question: string) => void
  onInspect: (id: string) => void
  onClear: () => void
}) {
  const [question, setQuestion] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const hasReport = items.length > 0
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [messages, busy])
  return (
    <>
      <ScreenHeader
        title="Ask HazardWatch"
        description="Ask about severity and features, or rank / compare locations in the review queue."
      />
      <section className="hw-panel hw-chat">
        <div className="hw-chat-heading">
          <span>HazardWatchAI · approved reports</span>
          <button className="hw-text-button" disabled={!messages.length} onClick={onClear}>
            Clear conversation
          </button>
        </div>
        <div
          ref={log}
          className="hw-chat-log"
          role="log"
          aria-label="Conversation"
          aria-live="polite"
        >
          {!hasReport ? (
            <div className="hw-chat-empty">
              <h2>Approve a report to start a conversation.</h2>
              <p>
                Assess uploaded media and confirm its map location before asking about the evidence.
              </p>
            </div>
          ) : !messages.length && !busy ? (
            <div className="hw-chat-empty">
              <h2>Start with a question.</h2>
              <p>
                Ask about the selected report, rank the review queue, explain why a location is
                first, or compare two sites.
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <article key={index} className={`hw-message hw-message-${message.role}`}>
                <strong>{message.role === 'user' ? 'You' : 'HazardWatchAI'}</strong>
                <p>
                  <RichText text={message.text} />
                </p>
                {message.refs?.length ? (
                  <div className="hw-source-links">
                    {message.refs.map((id) => (
                      <button key={id} className="hw-text-button" onClick={() => onInspect(id)}>
                        {items.find((item) => item.id === id)?.name} <ArrowRight size={14} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          )}
          {busy && (
            <article className="hw-message hw-message-assistant">
              <strong>HazardWatchAI</strong>
              <p role="status">Thinking…</p>
            </article>
          )}
        </div>
        <div className="hw-chat-composer">
          {unavailableReason && (
            <p className="hw-error" role="alert">
              {unavailableReason}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (question.trim() && !busy && hasReport) {
                onAsk(question.trim())
                setQuestion('')
              }
            }}
          >
            <label htmlFor="hw-question" className="hw-sr-only">
              Ask about the selected assessment
            </label>
            <input
              id="hw-question"
              maxLength={500}
              required
              disabled={busy || !hasReport}
              placeholder="Ask to rank, compare, or explain a priority…"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button
              className="hw-button"
              aria-label="Send question"
              disabled={busy || !hasReport || !question.trim()}
            >
              <Send size={18} />
            </button>
          </form>
          <p className="hw-note">
            Replies use your approved reports. Verify conclusions against the original evidence.
          </p>
        </div>
      </section>
    </>
  )
}
