import { z } from 'zod'
import { captureTimeNow, coordinateSchema, inMapCoverage } from '@/features/hazardwatch/location'

export type Severity = 'None' | 'Low' | 'Moderate' | 'High' | 'Extreme'
export type SeverityFilter = Severity | 'All'

const severityRank: Record<Severity, number> = {
  None: 0,
  Low: 1,
  Moderate: 2,
  High: 3,
  Extreme: 4,
}

export function sortIncidentsBySeverity(items: Incident[]): Incident[] {
  return [...items].sort((a, b) => severityRank[b.severity] - severityRank[a.severity])
}

/** Notebook-aligned feature keys → display label. */
export function formatFeatureLabel(key: string): string {
  return key.split('_').join(' ')
}

export function featureScoresDescending(
  scores: Record<string, number> | undefined
): [string, number][] {
  if (!scores) return []
  return Object.entries(scores).sort((a, b) => b[1] - a[1])
}
export type View = 'overview' | 'map' | 'hazard' | 'reports' | 'assistant'
export interface Incident {
  id: string
  name: string
  area: string
  severity: Severity
  hazard: string
  confidence: number
  images: number
  time: string
  source: string
  lat: number
  lng: number
  hectares: string
  quality: string
  reviewed: boolean
  photo?: string
  video?: string
  capturedAt?: string
  locationSource?: string
  countryCode?: 'AU' | 'NZ'
  region?: string
  /** Legacy queue blurb; prefer explainability in UI. */
  reason: string
  context: string
  /** HazardWatchAI / vision explainability shown under “Why this needs attention”. */
  explainability: string
  /** Per-feature model confidence 0–100 (shown in assessment panel). */
  keyFeatureScores: Record<string, number>
  uncertainty?: string
}
export interface Message {
  role: 'user' | 'assistant'
  text: string
  refs?: string[]
}
export const sources = ['Ground/Citizen', 'Satellite', 'Drone/Aerial'] as const
export const reportSchema = z.object({
  location: z.string().trim().min(1, 'Enter a location.').max(240),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a capture time.')
    .refine((value) => {
      const date = new Date(value + ':00Z')
      return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 16) === value &&
        value <= captureTimeNow()
      )
    }, 'Use a valid capture time on or before the current Sydney time.'),
  source: z.enum(sources),
  notes: z.string().trim().max(600),
  coordinates: coordinateSchema.optional(),
})
export type ReportContext = z.infer<typeof reportSchema>

export interface MediaAssessment {
  severity: Severity
  confidence: number
  hazard: string
  keyFeatures: string[]
  keyFeatureScores: Record<string, number>
  explainability: string
  modality: string
  inputType: 'image' | 'video'
  framesSampled?: number
  durationSec?: number
  needsReview?: boolean
}

export interface Report extends ReportContext {
  id: string
  preview: string
  mediaType: 'image' | 'video'
  assessment?: MediaAssessment
  approved?: boolean
}

export function approvalError(report: Report): string | null {
  if (!report.assessment) return 'A severity assessment is required before map approval.'
  const point = coordinateSchema.safeParse(report.coordinates)
  if (!point.success) return 'Confirm a complete, valid latitude and longitude before approval.'
  if (!inMapCoverage(point.data))
    return 'This location is outside the current Australia/New Zealand map coverage. The report stays in the register.'
  return null
}

export function reportToIncident(report: Report): Incident | null {
  if (report.approved !== true || approvalError(report)) return null
  const point = coordinateSchema.parse(report.coordinates)
  const assessment = report.assessment!
  return {
    id: report.id,
    name: report.location,
    area: report.location,
    severity: assessment.severity,
    hazard: assessment.hazard,
    confidence: assessment.confidence,
    images: report.mediaType === 'video' ? assessment.framesSampled || 1 : 1,
    time: report.date.slice(11, 16),
    capturedAt: report.date,
    source: report.source,
    lat: point.latitude,
    lng: point.longitude,
    locationSource: point.source,
    countryCode: point.countryCode,
    region: point.region,
    hectares: '—',
    quality: report.mediaType === 'video' ? 'Video' : 'Uploaded',
    reviewed: false,
    photo: report.mediaType === 'image' ? report.preview : undefined,
    video: report.mediaType === 'video' ? report.preview : undefined,
    reason: assessment.explainability,
    explainability: assessment.explainability,
    context: report.notes || `${report.mediaType} assessment. Location confirmed for this report.`,
    keyFeatureScores: assessment.keyFeatureScores,
  }
}

export function filterIncidents(items: Incident[], severity: SeverityFilter = 'All'): Incident[] {
  return items.filter((item) => severity === 'All' || item.severity === severity)
}
export function validateMedia(file?: Pick<File, 'type' | 'size'> | null): string {
  if (!file) return 'Choose an image or video to continue.'
  const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  const isVideo = ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)
  if (!isImage && !isVideo) {
    return 'Choose a JPG, PNG, WebP, MP4, WebM or MOV file.'
  }
  if (file.size > 25 * 1024 * 1024) {
    return 'This file is too large. Choose a file under 25 MB.'
  }
  if (!file.size) return 'This file is empty. Choose another file.'
  return ''
}
export const viewLabels: Record<View, string> = {
  overview: 'Overview',
  map: 'Hazard map',
  hazard: 'Hazard assessment',
  reports: 'Media reports',
  assistant: 'Ask HazardWatch',
}
