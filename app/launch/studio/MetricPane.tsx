'use client'

import { useEffect, useRef, useState } from 'react'
import type { GridCase, LossSpec, LossTerm, LossTermName } from '@/lib/zap'
import { KNOWN_LOSS_TERMS } from '@/lib/zap'
import type { SolveState } from './Studio'

export function MetricPane({
  grid, solve, lossSpec, onLossSpecChange, onRerun,
}: {
  grid: GridCase | null
  solve: SolveState
  lossSpec: LossSpec
  onLossSpecChange: (s: LossSpec) => void
  onRerun: (s: LossSpec) => void
}) {
  const [draft, setDraft] = useState<LossSpec>(lossSpec)
  const skipNextProp = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (skipNextProp.current) { skipNextProp.current = false; return }
    setDraft(lossSpec)
  }, [lossSpec])

  const debouncedRerun = (next: LossSpec) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      skipNextProp.current = true
      onRerun(next)
    }, 700)
  }

  const updateWeight = (name: LossTermName, weight: number) => {
    const next: LossSpec = {
      terms: draft.terms.map(t => t.name === name ? { ...t, weight } : t),
    }
    setDraft(next)
    onLossSpecChange(next)
    debouncedRerun(next)
  }

  const removeTerm = (name: LossTermName) => {
    const next: LossSpec = { terms: draft.terms.filter(t => t.name !== name) }
    if (!next.terms.length) {
      next.terms = [{ name: 'dispatch_cost', weight: 1.0 }]
    }
    setDraft(next)
    onLossSpecChange(next)
    debouncedRerun(next)
  }

  const addTerm = (name: LossTermName) => {
    if (draft.terms.some(t => t.name === name)) return
    const meta = KNOWN_LOSS_TERMS[name]
    const next: LossSpec = {
      terms: [...draft.terms, { name, weight: meta.defaultWeight }],
    }
    setDraft(next)
    onLossSpecChange(next)
    debouncedRerun(next)
  }

  const activeNames = new Set(draft.terms.map(t => t.name))
  const inactive = (Object.keys(KNOWN_LOSS_TERMS) as LossTermName[]).filter(n => !activeNames.has(n))

  const lossPieces = draft.terms.map(t => {
    const meta = KNOWN_LOSS_TERMS[t.name]
    return { txt: `${t.weight.toFixed(2)}·${shortLabel(t.name)}`, color: meta.color }
  })

  return (
    <div className="metric-pane">
      <div className="pane-title">Metric</div>

      <div className="metric-formula">
        <span className="formula-lhs">L</span>
        <span className="formula-eq">=</span>
        {lossPieces.map((p, i) => (
          <span key={i}>
            {i > 0 && <span className="formula-plus"> + </span>}
            <span style={{ color: p.color }}>{p.txt}</span>
          </span>
        ))}
        <span className="formula-plus"> + </span>
        <span className="formula-inv">InvestmentCost</span>
      </div>

      <div className="metric-sliders">
        {draft.terms.map(term => {
          const meta = KNOWN_LOSS_TERMS[term.name]
          const max = meta.defaultWeight * 5
          return (
            <div key={term.name} className="slider-row">
              <div className="slider-label">
                <span>
                  {meta.label}
                  <i className="slider-unit">{meta.unit}</i>
                </span>
                <span>
                  <b style={{ color: meta.color }}>{term.weight.toFixed(2)}</b>
                  <button
                    className="term-remove"
                    onClick={() => removeTerm(term.name)}
                    title="Remove term"
                  >×</button>
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={max}
                step={max / 100}
                value={term.weight}
                onChange={e => updateWeight(term.name, parseFloat(e.target.value))}
                style={{ accentColor: meta.color }}
              />
            </div>
          )
        })}

        {inactive.length > 0 && (
          <div className="add-term-row">
            <span>add term:</span>
            {inactive.map(n => (
              <button key={n} className="add-term-btn" onClick={() => addTerm(n)}>
                + {shortLabel(n)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="metric-rerun-hint">
        {solve.running
          ? `iter ${solve.iter}/${solve.steps ?? '—'} · loss ${solve.loss.toFixed(0)}`
          : 'slide to re-optimize'}
      </div>

      {solve.history.length > 0 && (
        <>
          <div className="pane-subtitle" style={{ paddingLeft: 16 }}>Loss curve</div>
          <LossSparkline data={solve.history.map(h => h.loss)} />
        </>
      )}

      {grid && (
        <div className="metric-caps">
          <div className="pane-subtitle">Capacities</div>
          {grid.generators.map((g, i) => {
            const cur = solve.gen_capacity_mw[i] ?? g.capacity_mw
            const delta = cur - g.capacity_mw
            return (
              <div key={g.id} className="cap-row">
                <span>{g.name}</span>
                <b>{cur.toFixed(0)} MW</b>
                <i className={delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : ''}>
                  {delta > 0 ? '+' : ''}{delta.toFixed(0)}
                </i>
              </div>
            )
          })}
          <div className="pane-subtitle" style={{ marginTop: 12 }}>Branches</div>
          {(() => {
            let v = 0
            return grid.branches.map(b => {
              if (b.fixed) return null
              const cur = solve.line_capacity_mw[v++] ?? b.capacity_mw
              const delta = cur - b.capacity_mw
              return (
                <div key={b.id} className="cap-row">
                  <span>{b.id}</span>
                  <b>{cur.toFixed(0)} MW</b>
                  <i className={delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : ''}>
                    {delta > 0 ? '+' : ''}{delta.toFixed(0)}
                  </i>
                </div>
              )
            })
          })()}
        </div>
      )}
    </div>
  )
}

function shortLabel(name: LossTermName): string {
  return {
    dispatch_cost: 'Cost',
    emissions: 'Emissions',
    inv_burden: 'InvBurden',
    peak_line_loading: 'PeakLineLoad',
  }[name]
}

function LossSparkline({ data }: { data: number[] }) {
  if (!data.length) return null
  const W = 256, H = 60
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * (W - 4) + 2
    const y = H - 2 - ((v - min) / range) * (H - 4)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width={W} height={H} className="loss-spark">
      <polyline points={pts.join(' ')} fill="none" stroke="#1a1a1a" strokeWidth={1.5} />
    </svg>
  )
}
