import type { Severity } from '@/features/hazardwatch/model'
import { z } from 'zod'
import { coordinateSchema } from '@/features/hazardwatch/location'

export type VisionSeverity = 'none' | 'low' | 'moderate' | 'high' | 'extreme'

export interface SeverityJson {
  input_type: 'image' | 'video'
  severity: VisionSeverity
  severity_confidence: number
  severity_index: number
  key_features: string[]
  key_feature_scores: Record<string, number>
  severity_scores?: Record<string, number>
  modality?: string
  explainability_note?: string | null
  duration_sec?: number | null
  frames_sampled?: number | null
  severity_frame_counts?: Record<string, number> | null
  needs_review?: boolean
  review_reason?: string | null
}

const VISION_API =
  process.env.NEXT_PUBLIC_VISION_API_URL?.replace(/\/$/, '') || 'http://localhost:8000'

export function sourceToModality(source: string): 'satellite' | 'drone' | 'ground' {
  if (source === 'Satellite') return 'satellite'
  if (source === 'Drone/Aerial') return 'drone'
  return 'ground'
}

export function toUiSeverity(severity: VisionSeverity): Severity {
  const map: Record<VisionSeverity, Severity> = {
    none: 'None',
    low: 'Low',
    moderate: 'Moderate',
    high: 'High',
    extreme: 'Extreme',
  }
  return map[severity]
}

/** Convert 0–1 feature scores to 0–100 for the assessment panel. */
export function featureScoresAsPercent(scores: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(scores).map(([k, v]) => [k, Math.round((v <= 1 ? v * 100 : v) * 10) / 10])
  )
}

export async function assessMedia(
  file: File,
  mediaType: 'image' | 'video',
  modality: 'satellite' | 'drone' | 'ground',
  signal?: AbortSignal
): Promise<SeverityJson> {
  const form = new FormData()
  form.append('file', file)
  form.append('modality', modality)
  const path = mediaType === 'video' ? '/v1/assess/video' : '/v1/assess/image'
  const res = await fetch(`${VISION_API}${path}`, {
    method: 'POST',
    body: form,
    signal,
  })
  if (!res.ok) {
    let detail = `Assessment failed (${res.status})`
    try {
      const body = (await res.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  const parsed = z
    .object({
      input_type: z.enum(['image', 'video']),
      severity: z.enum(['none', 'low', 'moderate', 'high', 'extreme']),
      severity_confidence: z.number().finite().min(0).max(1),
      severity_index: z.number().int().min(0).max(4),
      key_features: z.array(z.string()),
      key_feature_scores: z.record(z.number().finite().min(0).max(100)),
      modality: z.string().optional(),
      explainability_note: z.string().nullable().optional(),
      frames_sampled: z.number().int().positive().nullable().optional(),
      duration_sec: z.number().nonnegative().nullable().optional(),
      needs_review: z.boolean().optional(),
      review_reason: z.string().nullable().optional(),
    })
    .safeParse(await res.json())
  if (!parsed.success)
    throw new Error('The vision service returned an invalid assessment. Please try again.')
  return parsed.data
}

export interface MediaLocationMetadata {
  status: 'found' | 'missing' | 'unsupported' | 'invalid'
  latitude: number | null
  longitude: number | null
  source: 'exif' | 'quicktime' | null
  detail: string
}

export async function readMediaLocation(
  file: File,
  signal: AbortSignal
): Promise<MediaLocationMetadata> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${VISION_API}/v1/media/location`, {
    method: 'POST',
    body: form,
    signal,
  })
  if (!response.ok)
    throw new Error('Location metadata could not be read. Enter a location manually.')
  const result = z
    .object({
      status: z.enum(['found', 'missing', 'unsupported', 'invalid']),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
      source: z.enum(['exif', 'quicktime']).nullable(),
      detail: z.string(),
    })
    .safeParse(await response.json())
  if (!result.success) throw new Error('Invalid location metadata. Enter a location manually.')
  if (result.data.status === 'found' && !coordinateSchema.safeParse({ ...result.data }).success) {
    throw new Error('Invalid coordinates in media metadata. Enter a location manually.')
  }
  return result.data
}

export function incidentToSeverityJson(incident: {
  severity: Severity
  confidence: number
  keyFeatureScores?: Record<string, number>
  explainability?: string
  reason?: string
  source?: string
  quality?: string
  images?: number
}): SeverityJson {
  const map: Record<Severity, VisionSeverity> = {
    None: 'none',
    Low: 'low',
    Moderate: 'moderate',
    High: 'high',
    Extreme: 'extreme',
  }
  const severity = map[incident.severity]
  const scores01 = Object.fromEntries(
    Object.entries(incident.keyFeatureScores || {}).map(([k, v]) => [k, v > 1 ? v / 100 : v])
  )
  const key_features = Object.entries(scores01)
    .filter(([, v]) => v >= 0.4)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
  const modality = sourceToModality(incident.source || 'Ground/Citizen')
  const input_type: 'image' | 'video' = (incident.quality || '').toLowerCase().includes('video')
    ? 'video'
    : 'image'

  return {
    input_type,
    severity,
    severity_confidence: Math.min(1, Math.max(0, incident.confidence / 100)),
    severity_index: ['none', 'low', 'moderate', 'high', 'extreme'].indexOf(severity),
    key_features,
    key_feature_scores: scores01,
    modality,
    explainability_note: incident.explainability || incident.reason || null,
    frames_sampled: input_type === 'video' ? incident.images : null,
  }
}

export interface IncidentCard {
  id: string
  name: string
  area: string
  severity: VisionSeverity
  confidence: number
  key_features: string[]
  supporting_images: number
  source: string
  reviewed: boolean
  explainability?: string | null
}

export function incidentToCard(incident: {
  id: string
  name: string
  area: string
  severity: Severity
  confidence: number
  keyFeatureScores?: Record<string, number>
  images: number
  source: string
  reviewed: boolean
  explainability?: string
  reason?: string
}): IncidentCard {
  const map: Record<Severity, VisionSeverity> = {
    None: 'none',
    Low: 'low',
    Moderate: 'moderate',
    High: 'high',
    Extreme: 'extreme',
  }
  const scores01 = Object.fromEntries(
    Object.entries(incident.keyFeatureScores || {}).map(([k, v]) => [k, v > 1 ? v / 100 : v])
  )
  const key_features = Object.entries(scores01)
    .filter(([, v]) => v >= 0.4)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
  return {
    id: incident.id,
    name: incident.name,
    area: incident.area,
    severity: map[incident.severity],
    confidence: Math.min(1, Math.max(0, incident.confidence / 100)),
    key_features,
    supporting_images: incident.images,
    source: incident.source,
    reviewed: incident.reviewed,
    explainability: incident.explainability || incident.reason || null,
  }
}

export async function chatAboutAssessment(
  message: string,
  severityJson: SeverityJson,
  history: { role: string; content: string }[],
  incidents: IncidentCard[] = [],
  selectedId?: string
): Promise<{ reply: string; refs: string[] }> {
  const res = await fetch(`${VISION_API}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      severity_json: severityJson,
      history,
      incidents,
      selected_id: selectedId ?? null,
    }),
  })
  if (!res.ok) {
    let detail = `Chat failed (${res.status})`
    try {
      const body = (await res.json()) as { detail?: string }
      if (body.detail) detail = typeof body.detail === 'string' ? body.detail : detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  const data = (await res.json()) as { reply: string; refs?: string[] }
  return { reply: data.reply, refs: data.refs ?? [] }
}
