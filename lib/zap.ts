export type Bus = {
  id: number
  lat: number
  lng: number
  name: string
  type: 'generator' | 'datacenter' | 'junction'
}

export type Branch = {
  id: string
  src: number
  dst: number
  capacity_mw: number
  fixed: boolean
}

export type GeneratorInfo = {
  id: number
  name: string
  bus: number
  capacity_mw: number
  cost_per_mwh: number
  emissions_g_per_kwh: number
}

export type LoadInfo = {
  id: string
  bus: number
  profile_mw: number[]
}

export type GridCase = {
  name: string
  time_horizon: number
  buses: Bus[]
  branches: Branch[]
  generators: GeneratorInfo[]
  loads: LoadInfo[]
}

export type ExpandWeights = {
  cost?: number
  emissions?: number
}

export type LossTermName =
  | 'dispatch_cost'
  | 'emissions'
  | 'inv_burden'
  | 'peak_line_loading'

export type LossTerm = { name: LossTermName; weight: number }
export type LossSpec = { terms: LossTerm[] }

export const KNOWN_LOSS_TERMS: Record<LossTermName, { label: string; unit: string; defaultWeight: number; color: string }> = {
  dispatch_cost:     { label: 'Dispatch cost',      unit: '$',         defaultWeight: 1.0,    color: '#1a1a1a' },
  emissions:         { label: 'Emissions',          unit: 'g CO₂',     defaultWeight: 1.0,    color: '#1f8a2a' },
  inv_burden:        { label: 'Investment burden',  unit: 'ΔMW (L1)',  defaultWeight: 100.0,  color: '#b56c1a' },
  peak_line_loading: { label: 'Peak line loading',  unit: '— (smax)',  defaultWeight: 10000.0, color: '#9c2bb5' },
}

export type ExpandIterEvent = {
  iter: number
  loss: number
  op_cost: number
  inv_cost: number
  grad_norm: number
  gen_capacity_mw: number[]
  line_capacity_mw: number[]
  elapsed_s: number
}

export type ExpandStartEvent = {
  device: string
  steps: number
  weights: ExpandWeights
  initial: { generator: number[]; ac_line: number[] }
}

export type ExpandDoneEvent = {
  final: { generator: number[]; ac_line: number[] }
  elapsed_s: number
}

export const MODAL_URL =
  process.env.ZAP_MODAL_URL ??
  'https://llanocook--steinmetz-zap-serve-fastapi-app.modal.run'

export const MODAL_TOKEN = process.env.ZAP_API_TOKEN ?? ''

export function modalHeaders(extra: HeadersInit = {}): HeadersInit {
  const h: Record<string, string> = { ...(extra as Record<string, string>) }
  if (MODAL_TOKEN) h['x-zap-token'] = MODAL_TOKEN
  return h
}
