'use client'

import dynamic from 'next/dynamic'
import { useCallback, useMemo, useState } from 'react'
import type { GridCase, LossSpec } from '@/lib/zap'
import './studio.css'

const MapView = dynamic(() => import('./MapView').then(m => m.MapView), { ssr: false })
const SchematicView = dynamic(() => import('./SchematicView').then(m => m.SchematicView), { ssr: false })
const ChatPane = dynamic(() => import('./ChatPane').then(m => m.ChatPane), { ssr: false })
const MetricPane = dynamic(() => import('./MetricPane').then(m => m.MetricPane), { ssr: false })

export type SolveState = {
  iter: number
  loss: number
  gen_capacity_mw: number[]
  line_capacity_mw: number[]
  history: { iter: number; loss: number }[]
  running: boolean
  device?: string
  steps?: number
}

const EMPTY_SOLVE: SolveState = {
  iter: 0,
  loss: 0,
  gen_capacity_mw: [],
  line_capacity_mw: [],
  history: [],
  running: false,
}

export function Studio({ initialCase }: { initialCase: GridCase | null }) {
  const [grid] = useState<GridCase | null>(initialCase)
  const [view, setView] = useState<'map' | 'schematic'>('map')
  const [solve, setSolve] = useState<SolveState>(EMPTY_SOLVE)
  const [error, setError] = useState<string | null>(null)
  const [lossSpec, setLossSpec] = useState<LossSpec>({
    terms: [{ name: 'dispatch_cost', weight: 1.0 }],
  })

  const liveGen = useMemo(() => {
    if (!grid) return []
    if (solve.gen_capacity_mw.length === grid.generators.length) return solve.gen_capacity_mw
    return grid.generators.map(g => g.capacity_mw)
  }, [grid, solve.gen_capacity_mw])

  const liveLine = useMemo(() => {
    if (!grid) return []
    const variable = grid.branches.filter(b => !b.fixed)
    if (solve.line_capacity_mw.length === variable.length) {
      const out: number[] = []
      let v = 0
      for (const b of grid.branches) {
        if (b.fixed) out.push(b.capacity_mw)
        else out.push(solve.line_capacity_mw[v++])
      }
      return out
    }
    return grid.branches.map(b => b.capacity_mw)
  }, [grid, solve.line_capacity_mw])

  const runExpand = useCallback(async (spec: LossSpec, steps = 30) => {
    setError(null)
    setLossSpec(spec)
    setSolve({ ...EMPTY_SOLVE, running: true, steps })

    let res: Response
    try {
      res = await fetch('/api/zap/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loss_spec: spec, steps, step_size: 0.5 }),
      })
    } catch (e) {
      setError(String(e))
      setSolve(s => ({ ...s, running: false }))
      return
    }
    if (!res.ok || !res.body) {
      setError(`expand failed: ${res.status}`)
      setSolve(s => ({ ...s, running: false }))
      return
    }

    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''

    const history: { iter: number; loss: number }[] = []

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })

      let blank
      while ((blank = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, blank)
        buf = buf.slice(blank + 2)
        let event = 'message'
        let dataLine = ''
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLine += line.slice(5).trim()
        }
        if (!dataLine) continue
        let payload: any
        try { payload = JSON.parse(dataLine) } catch { continue }

        if (event === 'start') {
          setSolve(s => ({
            ...s,
            device: payload.device,
            steps: payload.steps,
            gen_capacity_mw: payload.initial?.generator ?? [],
            line_capacity_mw: payload.initial?.ac_line ?? [],
          }))
        } else if (event === 'iter') {
          history.push({ iter: payload.iter, loss: payload.loss })
          setSolve(s => ({
            ...s,
            iter: payload.iter,
            loss: payload.loss,
            gen_capacity_mw: payload.gen_capacity_mw,
            line_capacity_mw: payload.line_capacity_mw,
            history: [...history],
          }))
        } else if (event === 'done') {
          setSolve(s => ({ ...s, running: false }))
        } else if (event === 'error') {
          setError(payload.message ?? 'unknown error')
          setSolve(s => ({ ...s, running: false }))
        }
      }
    }
  }, [])

  return (
    <div className="studio">
      <header className="studio-header">
        <div className="studio-brand">
          <img src="/spi-mark-filled.png" alt="" className="studio-mark" />
          <span className="studio-title">Steinmetz Studio</span>
          {grid && <span className="studio-case">{grid.name}</span>}
        </div>
        <div className="studio-view-toggle">
          <button
            className={view === 'map' ? 'active' : ''}
            onClick={() => setView('map')}
          >Geographic</button>
          <button
            className={view === 'schematic' ? 'active' : ''}
            onClick={() => setView('schematic')}
          >Schematic</button>
        </div>
      </header>

      <div className="studio-body">
        <aside className="studio-pane studio-chat-pane">
          <ChatPane
            grid={grid}
            solve={solve}
            lossSpec={lossSpec}
            onRunExpansion={({ lossSpec: spec, steps }) => runExpand(spec, steps)}
            onDefineLoss={setLossSpec}
          />
        </aside>

        <main className="studio-pane studio-canvas">
          {!grid && (
            <div className="studio-empty">
              Modal backend unreachable. Set <code>ZAP_MODAL_URL</code> or deploy <code>modal_serve.py</code>.
            </div>
          )}
          {grid && view === 'map' && (
            <MapView grid={grid} liveGen={liveGen} liveLine={liveLine} solve={solve} />
          )}
          {grid && view === 'schematic' && (
            <SchematicView grid={grid} liveGen={liveGen} liveLine={liveLine} />
          )}
          {error && <div className="studio-error">{error}</div>}
        </main>

        <aside className="studio-pane studio-metric-pane">
          <MetricPane
            grid={grid}
            solve={solve}
            lossSpec={lossSpec}
            onLossSpecChange={setLossSpec}
            onRerun={(spec) => { runExpand(spec, 30) }}
          />
        </aside>
      </div>
    </div>
  )
}

