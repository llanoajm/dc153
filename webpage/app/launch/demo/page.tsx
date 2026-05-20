'use client'

import { useEffect, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

type DemoResults = {
  generated_at: string
  machine: string
  elapsed_total_s: number
  blackwell: {
    racks: number
    peak_kw_per_rack: number
    idle_kw_per_rack: number
    pue: number
    utilization_per_step: number[]
    power_mw_per_step: number[]
    peak_mw: number
    idle_mw: number
    time_labels: string[]
    source: string
  }
  network: {
    nodes: { id: number; x: number; y: number; label: string; type: string }[]
    lines: { src: number; dst: number; param_idx: number | null; nominal_mw: number; fixed: boolean; label: string }[]
    generators: { node: number; name: string; param_idx: number; initial_mw: number; cost_mwh: number; color: string }[]
    time_steps: string[]
  }
  mep_gd: {
    elapsed_s: number
    initial_gen_capacity_mw: number[]
    initial_line_capacity_mw: number[]
    final_gen_capacity_mw: number[]
    final_line_capacity_mw: number[]
    cost_history: number[]
    op_cost: number | null
    inv_cost: number | null
  }
  mep_nn: {
    elapsed_s: number
    n_samples_valid: number
    train_loss_history: number[]
    surrogate_cost_history: number[]
    initial_gen_capacity_mw: number[]
    initial_line_capacity_mw: number[]
    final_gen_capacity_mw: number[]
    final_line_capacity_mw: number[]
  }
  rl: {
    elapsed_s: number
    num_episodes: number
    episode_rewards: number[]
    episode_costs: number[]
    final_caps_per_scenario: Record<string, {
      final_gen_capacity_mw: number[]
      final_line_capacity_mw: number[]
      final_cost: number
      utilization: number
    }>
    initial_gen_capacity_mw: number[]
    initial_line_capacity_mw: number[]
    scenarios: Record<string, string>
  }
}

// ── Color palette ──────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, string> = {
  generator_load:    '#2b6cb0',
  generator_storage: '#276749',
  datacenter:        '#553c9a',
  generator:         '#c05621',
}
const LINE_COLOR  = '#a0aec0'
const DC_COLOR    = '#805ad5'
const TEXT        = '#1a202c'
const MUTED       = '#718096'
const BORDER      = '#e2e8f0'
const BG_CARD     = '#f7fafc'

// ── SVG helpers ────────────────────────────────────────────────────────────

function Sparkline({
  data, width, height, color = '#2b6cb0',
}: { data: number[]; width: number; height: number; color?: string }) {
  if (!data.length) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - 2) + 1
    const y = height - 2 - ((v - min) / range) * (height - 4)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}

function CapacityBar({
  initial, final, max, label, color,
}: { initial: number; final: number; max: number; label: string; color: string }) {
  const W = 160
  const H = 12
  const iW = Math.max(2, (initial / max) * W)
  const fW = Math.max(2, (final   / max) * W)
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: MUTED, marginBottom: 2 }}>{label}</div>
      <svg width={W + 60} height={H * 2 + 2} style={{ display: 'block' }}>
        <rect x={0} y={0}    width={iW} height={H - 1} fill={`${color}55`} rx={2} />
        <rect x={0} y={H + 1} width={fW} height={H - 1} fill={color}       rx={2} />
        <text x={iW + 4} y={9}    fontSize={9} fill={MUTED}>{initial.toFixed(0)}</text>
        <text x={fW + 4} y={H+9}  fontSize={9} fill={color}>{final.toFixed(0)} MW</text>
      </svg>
    </div>
  )
}

function GridSVG({ data, highlight }: { data: DemoResults; highlight: string }) {
  const { nodes, lines } = data.network
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]))

  const getCapacity = (paramIdx: number | null) => {
    if (paramIdx === null) return null
    const src = highlight === 'mep_gd'
      ? data.mep_gd.final_line_capacity_mw[paramIdx]
      : highlight === 'mep_nn'
      ? data.mep_nn.final_line_capacity_mw[paramIdx]
      : data.rl.final_caps_per_scenario['2']?.final_line_capacity_mw[paramIdx] ?? null
    return src
  }

  const getGenCapacity = (paramIdx: number) => {
    if (highlight === 'mep_gd')  return data.mep_gd.final_gen_capacity_mw[paramIdx]
    if (highlight === 'mep_nn')  return data.mep_nn.final_gen_capacity_mw[paramIdx]
    return data.rl.final_caps_per_scenario['2']?.final_gen_capacity_mw[paramIdx] ?? data.network.generators[paramIdx]?.initial_mw
  }

  const SVG_W = 780, SVG_H = 290
  const PAD_X = 60, PAD_Y = 40
  const scaleX = (x: number) => (x / 780) * (SVG_W - PAD_X * 2) + PAD_X
  const scaleY = (y: number) => (y / 400) * (SVG_H - PAD_Y * 2) + PAD_Y

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Lines */}
      {lines.map((l, i) => {
        const a = nodeMap[l.src], b = nodeMap[l.dst]
        const cap = getCapacity(l.param_idx)
        const strokeW = l.fixed ? 1.5 : Math.max(1.5, Math.min(5, (cap ?? l.nominal_mw) / 25))
        return (
          <g key={i}>
            <line
              x1={scaleX(a.x)} y1={scaleY(a.y)}
              x2={scaleX(b.x)} y2={scaleY(b.y)}
              stroke={l.fixed ? DC_COLOR : LINE_COLOR}
              strokeWidth={strokeW}
              strokeDasharray={l.fixed ? '4 3' : undefined}
              opacity={0.75}
            />
            {cap !== null && (
              <text
                x={(scaleX(a.x) + scaleX(b.x)) / 2 + 4}
                y={(scaleY(a.y) + scaleY(b.y)) / 2 - 4}
                fontSize={8} fill={MUTED} textAnchor="middle"
              >
                {cap.toFixed(0)} MW
              </text>
            )}
          </g>
        )
      })}

      {/* Nodes */}
      {nodes.map(n => {
        const cx = scaleX(n.x), cy = scaleY(n.y)
        const color = NODE_COLORS[n.type] ?? '#4a5568'
        const gen = data.network.generators.find(g => g.node === n.id)
        const genMw = gen ? getGenCapacity(gen.param_idx) : null
        const isDC = n.type === 'datacenter'
        return (
          <g key={n.id}>
            <circle cx={cx} cy={cy} r={isDC ? 20 : 16} fill={color} opacity={0.9} />
            {isDC && (
              <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
                fontSize={9} fill="#fff" fontFamily="monospace">DC</text>
            )}
            {!isDC && (
              <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
                fontSize={9} fill="#fff" fontFamily="monospace">{n.id}</text>
            )}
            <text x={cx} y={cy + (isDC ? 28 : 24)} textAnchor="middle"
              fontSize={9} fill={TEXT}>{n.label}</text>
            {genMw !== null && (
              <text x={cx} y={cy + (isDC ? 38 : 34)} textAnchor="middle"
                fontSize={8} fill={color}>⚡ {genMw.toFixed(0)} MW</text>
            )}
          </g>
        )
      })}

      {/* Legend */}
      <text x={8} y={SVG_H - 10} fontSize={8} fill={MUTED}>
        {highlight === 'mep_gd' ? 'Capacities: MEP-GD'
          : highlight === 'mep_nn' ? 'Capacities: MEP-NN'
          : 'Capacities: RL peak scenario'}
      </text>
    </svg>
  )
}

function BlackwellChart({ bw }: { data: DemoResults; bw: DemoResults['blackwell'] }) {
  const mw = bw.power_mw_per_step
  const maxMw = Math.max(...mw) * 1.15
  const W = 480, H = 80, n = mw.length
  const barW = W / n - 8

  return (
    <svg width={W} height={H + 30} style={{ display: 'block', overflow: 'visible' }}>
      {mw.map((v, i) => {
        const h = (v / maxMw) * H
        const x = i * (W / n) + 4
        const pct = (bw.utilization_per_step[i] * 100).toFixed(0)
        return (
          <g key={i}>
            <rect x={x} y={H - h} width={barW} height={h} fill="#553c9a" rx={2} opacity={0.85} />
            <text x={x + barW / 2} y={H - h - 3} textAnchor="middle" fontSize={9} fill={TEXT}>
              {v.toFixed(1)} MW
            </text>
            <text x={x + barW / 2} y={H + 12} textAnchor="middle" fontSize={8} fill={MUTED}>
              {bw.time_labels[i].split(' ')[0]}
            </text>
            <text x={x + barW / 2} y={H + 22} textAnchor="middle" fontSize={7} fill={'#805ad5'}>
              {pct}% util
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Pending state ──────────────────────────────────────────────────────────

function PendingState() {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 16,
    }}>
      <div style={{ fontSize: 13, color: MUTED, fontFamily: 'monospace', letterSpacing: '0.08em' }}>
        COMPUTING…
      </div>
      <div style={{ fontSize: 11, color: MUTED, maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
        Results are being generated. Run{' '}
        <code style={{ background: BG_CARD, padding: '1px 4px', borderRadius: 3 }}>
          python -m zap.demo.run_all
        </code>{' '}
        locally or{' '}
        <code style={{ background: BG_CARD, padding: '1px 4px', borderRadius: 3 }}>
          modal run --detach modal_demo.py --gpu
        </code>{' '}
        for a GPU run.
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

const METHODS = [
  { key: 'mep_gd',  label: 'MEP — Gradient Descent', desc: 'Implicit diff through ADMM' },
  { key: 'mep_nn',  label: 'MEP — NN Surrogate',      desc: 'MLP cost model + Adam' },
  { key: 'rl',      label: 'RL — DQN Expansion',      desc: 'Load-adaptable policy' },
]

export default function DemoPage() {
  const [status, setStatus] = useState<'loading' | 'pending' | 'ready'>('loading')
  const [results, setResults] = useState<DemoResults | null>(null)
  const [tab, setTab] = useState('mep_gd')

  useEffect(() => {
    fetch('/api/demo-results')
      .then(r => r.json())
      .then(({ status: s, data }) => {
        setStatus(s)
        if (data) setResults(data)
      })
      .catch(() => setStatus('pending'))
  }, [])

  const styles = {
    page: {
      minHeight: '100vh',
      background: '#fff',
      color: TEXT,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 13,
    } as React.CSSProperties,
    header: {
      borderBottom: `1px solid ${BORDER}`,
      padding: '24px 40px 20px',
    } as React.CSSProperties,
    title: {
      fontSize: 22,
      fontWeight: 600,
      letterSpacing: '-0.02em',
      marginBottom: 4,
    } as React.CSSProperties,
    sub: {
      fontSize: 12,
      color: MUTED,
      maxWidth: 680,
      lineHeight: 1.6,
    } as React.CSSProperties,
    body: {
      padding: '24px 40px',
      maxWidth: 1100,
    } as React.CSSProperties,
    card: {
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      borderRadius: 8,
      padding: '16px 20px',
    } as React.CSSProperties,
    sectionTitle: {
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.1em',
      color: MUTED,
      textTransform: 'uppercase' as const,
      marginBottom: 12,
    },
    tabs: {
      display: 'flex',
      gap: 4,
      marginBottom: 16,
      borderBottom: `1px solid ${BORDER}`,
      paddingBottom: 1,
    } as React.CSSProperties,
    tab: (active: boolean) => ({
      padding: '6px 14px',
      fontSize: 12,
      border: 'none',
      background: active ? TEXT : 'transparent',
      color: active ? '#fff' : MUTED,
      cursor: 'pointer',
      borderRadius: 4,
      fontWeight: active ? 600 : 400,
    } as React.CSSProperties),
    grid2: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 16,
    } as React.CSSProperties,
    grid3: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: 16,
      marginBottom: 24,
    } as React.CSSProperties,
    kv: {
      fontSize: 11,
      color: MUTED,
      marginBottom: 4,
    } as React.CSSProperties,
    kvVal: {
      fontSize: 16,
      fontWeight: 600,
      color: TEXT,
    } as React.CSSProperties,
  }

  if (status === 'loading') {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.title}>Grid Intelligence Demo</div>
        </div>
        <div style={{ padding: 40, color: MUTED, fontSize: 12 }}>Loading…</div>
      </div>
    )
  }

  if (status === 'pending' || !results) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.title}>Grid Intelligence Demo</div>
          <div style={styles.sub}>
            MEP via gradient descent · MEP via neural network surrogate · RL capacity expansion ·
            Blackwell GB200 NVL72 hyperscaler load
          </div>
        </div>
        <div style={styles.body}><PendingState /></div>
      </div>
    )
  }

  const { blackwell: bw, mep_gd, mep_nn, rl, network } = results
  const GEN_NAMES  = ['Peaker', 'Solar', 'Gas CCGT']
  const LINE_NAMES = ['L 0-1', 'L 1-3', 'L 3-0']

  const tabData = tab === 'mep_gd' ? mep_gd : tab === 'mep_nn' ? mep_nn : null
  const activeGens  = tab === 'mep_gd' ? mep_gd.final_gen_capacity_mw
    : tab === 'mep_nn' ? mep_nn.final_gen_capacity_mw
    : rl.final_caps_per_scenario['2']?.final_gen_capacity_mw ?? mep_gd.initial_gen_capacity_mw
  const activeLines = tab === 'mep_gd' ? mep_gd.final_line_capacity_mw
    : tab === 'mep_nn' ? mep_nn.final_line_capacity_mw
    : rl.final_caps_per_scenario['2']?.final_line_capacity_mw ?? mep_gd.initial_line_capacity_mw

  const maxGen  = Math.max(300, ...activeGens)
  const maxLine = Math.max(150, ...activeLines)

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>Grid Intelligence Demo</div>
        <div style={styles.sub}>
          Toy 7-node AC grid · Blackwell GB200 NVL72 datacenter load (50 racks, 120 kW peak, PUE {bw.pue}) ·
          MEP gradient descent · MLP surrogate · DQN reinforcement learning ·
          computed in {results.elapsed_total_s.toFixed(0)}s on {results.machine}
        </div>
      </div>

      <div style={styles.body}>

        {/* Summary cards */}
        <div style={styles.grid3}>
          {METHODS.map(m => {
            const d = m.key === 'mep_gd' ? mep_gd : m.key === 'mep_nn' ? mep_nn : rl
            const elapsed = d.elapsed_s
            const finalCost = m.key === 'mep_gd'
              ? mep_gd.cost_history.at(-1)
              : m.key === 'mep_nn'
              ? mep_nn.surrogate_cost_history.at(-1)
              : rl.episode_costs.at(-1)
            return (
              <div key={m.key} style={styles.card}>
                <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  {m.desc}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{m.label}</div>
                <div style={styles.kv}>Total cost</div>
                <div style={styles.kvVal}>{finalCost != null ? finalCost.toFixed(0) : '—'}</div>
                <div style={{ marginTop: 8, ...styles.kv }}>Runtime</div>
                <div style={{ fontSize: 13, color: TEXT }}>{elapsed.toFixed(1)}s</div>
              </div>
            )
          })}
        </div>

        {/* Grid topology */}
        <div style={{ marginBottom: 24, ...styles.card }}>
          <div style={styles.sectionTitle}>Grid Topology — Final Capacities</div>
          <GridSVG data={results} highlight={tab} />
          <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
            Node size and line thickness reflect capacities from the selected method below.
            Dashed purple = dedicated datacenter feed (fixed 20 MW).
          </div>
        </div>

        {/* Method tabs */}
        <div style={styles.tabs}>
          {METHODS.map(m => (
            <button key={m.key} style={styles.tab(tab === m.key)} onClick={() => setTab(m.key)}>
              {m.label}
            </button>
          ))}
        </div>

        {/* MEP-GD detail */}
        {tab === 'mep_gd' && (
          <div style={styles.grid2}>
            <div style={styles.card}>
              <div style={styles.sectionTitle}>Cost History ({mep_gd.cost_history.length} iters)</div>
              <Sparkline data={mep_gd.cost_history} width={300} height={80} color="#2b6cb0" />
              <div style={{ marginTop: 8, fontSize: 11, color: MUTED }}>
                {mep_gd.op_cost != null && <>Op cost: {mep_gd.op_cost.toFixed(0)} · Inv cost: {mep_gd.inv_cost?.toFixed(0)}</>}
              </div>
            </div>
            <div style={styles.card}>
              <div style={styles.sectionTitle}>Final vs Initial Capacity</div>
              {GEN_NAMES.map((name, i) => (
                <CapacityBar key={name} label={name}
                  initial={mep_gd.initial_gen_capacity_mw[i]}
                  final={mep_gd.final_gen_capacity_mw[i]}
                  max={maxGen} color="#2b6cb0" />
              ))}
              {LINE_NAMES.map((name, i) => (
                <CapacityBar key={name} label={name}
                  initial={mep_gd.initial_line_capacity_mw[i]}
                  final={mep_gd.final_line_capacity_mw[i]}
                  max={maxLine} color="#4a5568" />
              ))}
              <div style={{ fontSize: 9, color: MUTED, marginTop: 6 }}>
                Light bar = initial · Dark bar = final
              </div>
            </div>
          </div>
        )}

        {/* MEP-NN detail */}
        {tab === 'mep_nn' && (
          <div style={styles.grid2}>
            <div style={styles.card}>
              <div style={styles.sectionTitle}>Surrogate Training Loss ({mep_nn.n_samples_valid} samples)</div>
              <Sparkline data={mep_nn.train_loss_history} width={300} height={60} color="#276749" />
              <div style={{ marginTop: 8, ...styles.sectionTitle }}>Surrogate Planning Cost</div>
              <Sparkline data={mep_nn.surrogate_cost_history} width={300} height={60} color="#2f855a" />
            </div>
            <div style={styles.card}>
              <div style={styles.sectionTitle}>Final vs Initial Capacity</div>
              {GEN_NAMES.map((name, i) => (
                <CapacityBar key={name} label={name}
                  initial={mep_nn.initial_gen_capacity_mw[i]}
                  final={mep_nn.final_gen_capacity_mw[i]}
                  max={maxGen} color="#276749" />
              ))}
              {LINE_NAMES.map((name, i) => (
                <CapacityBar key={name} label={name}
                  initial={mep_nn.initial_line_capacity_mw[i]}
                  final={mep_nn.final_line_capacity_mw[i]}
                  max={maxLine} color="#4a5568" />
              ))}
              <div style={{ fontSize: 9, color: MUTED, marginTop: 6 }}>
                Light bar = initial · Dark bar = surrogate-optimal
              </div>
            </div>
          </div>
        )}

        {/* RL detail */}
        {tab === 'rl' && (
          <div style={styles.grid2}>
            <div style={styles.card}>
              <div style={styles.sectionTitle}>Episode Rewards ({rl.num_episodes} episodes)</div>
              <Sparkline data={rl.episode_rewards} width={300} height={70} color="#c05621" />
              <div style={{ marginTop: 8, ...styles.sectionTitle }}>Episode Final Costs</div>
              <Sparkline data={rl.episode_costs} width={300} height={70} color="#e53e3e" />
            </div>
            <div style={styles.card}>
              <div style={styles.sectionTitle}>Final Capacities by Scenario</div>
              {Object.entries(rl.final_caps_per_scenario).map(([sc, caps]) => (
                <div key={sc} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: TEXT, marginBottom: 4 }}>
                    {rl.scenarios[sc]} · cost {caps.final_cost.toFixed(0)}
                  </div>
                  {GEN_NAMES.map((name, i) => (
                    <CapacityBar key={name} label={name}
                      initial={rl.initial_gen_capacity_mw[i]}
                      final={caps.final_gen_capacity_mw[i]}
                      max={maxGen} color="#c05621" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Blackwell power profile */}
        <div style={{ marginTop: 24, ...styles.card }}>
          <div style={styles.sectionTitle}>
            Blackwell GB200 NVL72 — {bw.racks} racks · {bw.peak_kw_per_rack} kW peak · {bw.idle_kw_per_rack} kW idle · PUE {bw.pue}
          </div>
          <BlackwellChart data={results} bw={bw} />
          <div style={{ marginTop: 8, fontSize: 10, color: MUTED }}>
            Facility draw = IT load × PUE. {bw.source}.
          </div>
        </div>

      </div>
    </div>
  )
}
