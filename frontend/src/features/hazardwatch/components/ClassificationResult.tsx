'use client'

import { ArrowLeft, Check, ImageOff, MessageSquare } from 'lucide-react'
import {
  featureScoresDescending,
  formatFeatureLabel,
  type Incident,
} from '@/features/hazardwatch/model'
import { ScreenHeader, SeverityBadge, RichText } from './ui'
import { HazardDirections } from './HazardDirections'
import { locationSources, type Coordinates } from '@/features/hazardwatch/location'

export function ClassificationResult({
  incident,
  onReview,
  onAsk,
}: {
  incident: Incident
  onReview: () => void
  onAsk: () => void
}) {
  const featureRows = featureScoresDescending(incident.keyFeatureScores)
  const explainability = incident.explainability || incident.reason
  const locationSource = incident.locationSource
    ? (locationSources[incident.locationSource as Coordinates['source']] ?? incident.locationSource)
    : undefined
  const captured = incident.capturedAt
    ? `Captured ${incident.capturedAt.replace('T', ' · ')} · Sydney time`
    : 'Capture time unavailable'

  return (
    <>
      <a href="#map" className="hw-back">
        <ArrowLeft size={16} /> Back to hazard map
      </a>
      <ScreenHeader title={incident.name} description={`${incident.area} · ${captured}`} />
      <div className="hw-assessment-grid">
        <section className="hw-panel hw-evidence" aria-label="Media evidence">
          {incident.video ? (
            <video
              className="hw-evidence-image"
              src={incident.video}
              controls
              playsInline
              aria-label={`Video evidence for ${incident.name}`}
            />
          ) : incident.photo ? (
            <img
              className="hw-evidence-image"
              src={incident.photo}
              alt={`Evidence for ${incident.name}`}
            />
          ) : (
            <div className="hw-missing-image">
              <ImageOff size={36} />
              <h2>Media not available</h2>
              <p>This report has no attached image or video.</p>
            </div>
          )}
          <div className="hw-panel-body">
            <div className="hw-section-heading">
              <h2>Evidence</h2>
              <span className="hw-muted">{incident.id}</span>
            </div>
            <p>{incident.context}</p>
            <dl className="hw-facts">
              <div>
                <dt>Source</dt>
                <dd>{incident.source}</dd>
              </div>
              <div>
                <dt>{incident.video ? 'Sampled video frames' : 'Supporting images'}</dt>
                <dd>{incident.images}</dd>
              </div>
              <div>
                <dt>Media type</dt>
                <dd>{incident.video ? 'Video' : 'Image'}</dd>
              </div>
              {incident.locationSource && (
                <>
                  <div>
                    <dt>Confirmed coordinates</dt>
                    <dd>
                      {incident.lat.toFixed(6)}, {incident.lng.toFixed(6)}
                    </dd>
                  </div>
                  <div>
                    <dt>Location source</dt>
                    <dd>{locationSource}</dd>
                  </div>
                </>
              )}
            </dl>
            <HazardDirections incident={incident} />
          </div>
        </section>
        <section className="hw-panel hw-panel-body" aria-labelledby="hw-classification-title">
          <div className="hw-section-heading">
            <h2 id="hw-classification-title">Classification</h2>
            <SeverityBadge severity={incident.severity} />
          </div>
          <p className="hw-classification">{incident.hazard}</p>
          <dl className="hw-result-stats">
            <div>
              <dt>Severity confidence</dt>
              <dd>{incident.confidence}%</dd>
            </div>
          </dl>
          {featureRows.length > 0 && (
            <div className="hw-feature-scores">
              <h3>Key feature confidences</h3>
              <dl className="hw-feature-score-list">
                {featureRows.map(([key, pct]) => (
                  <div key={key}>
                    <dt>{formatFeatureLabel(key)}</dt>
                    <dd>{Math.round(pct)}%</dd>
                  </div>
                ))}
              </dl>
              {incident.video && (
                <p className="hw-note">
                  For video, each score is the mean feature confidence across sampled frames.
                </p>
              )}
            </div>
          )}
          <h3>Why this needs attention</h3>
          <p className="hw-explainability">
            <RichText text={explainability} />
          </p>
          <div className="hw-stack">
            <button
              className={`hw-button ${incident.reviewed ? 'hw-secondary' : ''}`}
              onClick={onReview}
            >
              <Check size={18} />
              {incident.reviewed ? 'Undo review mark' : 'Mark as reviewed'}
            </button>
            <button className="hw-text-button" onClick={onAsk}>
              <MessageSquare size={17} /> Ask about this priority
            </button>
          </div>
          <p className="hw-note">A review mark records progress. It does not approve a dispatch.</p>
          <details className="hw-details">
            <summary>How to interpret severity</summary>
            <p>
              None: no clear bushfire hazard in the assessment. Low: ambiguous evidence requiring
              verification. Moderate: smoke or indirect signs needing confirmation. High: strong
              flame or smoke signals. Extreme: severe, active fire indicators across multiple
              features. Low does not mean safe.
            </p>
          </details>
        </section>
      </div>
    </>
  )
}
