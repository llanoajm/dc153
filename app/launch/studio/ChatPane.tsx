'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import type { GridCase, LossSpec } from '@/lib/zap'
import type { SolveState } from './Studio'

type RunExpansionArgs = {
  lossSpec: LossSpec
  steps: number
}

type Prebuilt = {
  id: string
  slash: string
  label: string
  prompt: string
}

const PREBUILTS: Prebuilt[] = [
  {
    id: 'expand-dc',
    slash: '/expand-for-datacenter',
    label: 'Expand for datacenter',
    prompt: 'Expand the grid so the Buenos Aires datacenter is fully served. Minimize cost.',
  },
  {
    id: 'min-emissions',
    slash: '/min-emissions',
    label: 'Minimize emissions',
    prompt: 'Minimize emissions while keeping dispatch cost reasonable. 30 iters.',
  },
  {
    id: 'balanced',
    slash: '/balanced',
    label: 'Cost + emissions balanced',
    prompt: 'Run an expansion that balances cost and emissions roughly evenly.',
  },
  {
    id: 'lean',
    slash: '/lean-expand',
    label: 'Cheap, lean build',
    prompt: 'Minimize cost AND minimize new MW built. Be stingy with capital — use inv_burden term.',
  },
  {
    id: 'congestion',
    slash: '/relieve-congestion',
    label: 'Relieve line congestion',
    prompt: 'The Andes interconnect and Patagonia evac line are stressed. Add a peak_line_loading term and re-expand.',
  },
  {
    id: 'describe',
    slash: '/describe-grid',
    label: 'Describe the grid',
    prompt: "What's on screen right now? Buses, lines, generators, demand.",
  },
  {
    id: 'explain',
    slash: '/explain-last-run',
    label: 'Explain last run',
    prompt: 'Tell me what changed in the latest run — capacities and loss trajectory.',
  },
]

export function ChatPane({
  grid, solve, lossSpec, onRunExpansion, onDefineLoss,
}: {
  grid: GridCase | null
  solve: SolveState
  lossSpec: LossSpec
  onRunExpansion: (args: RunExpansionArgs) => Promise<void>
  onDefineLoss: (spec: LossSpec) => void
}) {
  const gridRef = useRef(grid); gridRef.current = grid
  const solveRef = useRef(solve); solveRef.current = solve
  const lossRef = useRef(lossSpec); lossRef.current = lossSpec

  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), [])

  const { messages, sendMessage, addToolResult, status } = useChat({
    transport,
    async onToolCall({ toolCall }) {
      if (toolCall.toolName === 'define_loss') {
        const input = (toolCall.input ?? {}) as LossSpec
        const spec: LossSpec = { terms: input.terms ?? [] }
        onDefineLoss(spec)
        addToolResult({
          tool: 'define_loss',
          toolCallId: toolCall.toolCallId,
          output: { applied: spec },
        })
      } else if (toolCall.toolName === 'run_expansion') {
        const args = (toolCall.input ?? {}) as { loss_spec?: LossSpec; steps?: number }
        const spec: LossSpec = args.loss_spec ?? lossRef.current
        const steps = args.steps ?? 30
        onRunExpansion({ lossSpec: spec, steps }).catch(() => {})
        addToolResult({
          tool: 'run_expansion',
          toolCallId: toolCall.toolCallId,
          output: { started: true, loss_spec: spec, steps },
        })
      } else if (toolCall.toolName === 'describe_grid') {
        const g = gridRef.current
        const summary = g
          ? `${g.name}: ${g.buses.length} buses, ${g.branches.length} branches (${g.branches.filter(b => !b.fixed).length} expandable), ${g.generators.length} generators. Datacenter load on bus ${g.loads.find(l => l.id === 'datacenter')?.bus}. Generators: ${g.generators.map(gn => `${gn.name}@${gn.bus} ${gn.capacity_mw}MW (cost $${gn.cost_per_mwh}/MWh, ${gn.emissions_g_per_kwh} gCO2/kWh)`).join('; ')}.`
          : 'No grid loaded yet.'
        addToolResult({
          tool: 'describe_grid',
          toolCallId: toolCall.toolCallId,
          output: { summary },
        })
      } else if (toolCall.toolName === 'explain_result') {
        const s = solveRef.current
        const g = gridRef.current
        if (!s.history.length) {
          addToolResult({
            tool: 'explain_result',
            toolCallId: toolCall.toolCallId,
            output: { summary: 'No optimization has been run yet.' },
          })
          return
        }
        const first = s.history[0]?.loss ?? 0
        const last = s.history.at(-1)?.loss ?? 0
        const delta = ((last - first) / Math.max(1, first)) * 100
        const capLines = g
          ? g.generators
              .map((gn, i) => `${gn.name}: ${gn.capacity_mw.toFixed(0)} → ${(s.gen_capacity_mw[i] ?? gn.capacity_mw).toFixed(0)} MW`)
              .join(', ')
          : ''
        addToolResult({
          tool: 'explain_result',
          toolCallId: toolCall.toolCallId,
          output: {
            summary: `${s.history.length} iters, loss ${first.toFixed(0)} → ${last.toFixed(0)} (${delta.toFixed(1)}%). ${capLines}.`,
          },
        })
      }
    },
  })

  const [input, setInput] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length, status])

  const submit = (text: string) => {
    const t = text.trim()
    if (!t) return
    sendMessage({ text: t })
    setInput('')
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(input)
    }
  }

  const onChange = (v: string) => {
    setInput(v)
    setPaletteOpen(v.startsWith('/'))
  }

  const pickPrebuilt = (p: Prebuilt) => {
    setPaletteOpen(false)
    submit(p.prompt)
  }

  return (
    <div className="chat-pane">
      <div className="pane-title">Agent</div>

      <div className="chat-stream" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Tell the agent what to optimize. Try:</p>
            <ul>
              <li>“Minimize emissions, 30 iters”</li>
              <li>“Expand for the datacenter at peak load”</li>
              <li>Type <kbd>/</kbd> for prebuilts</li>
            </ul>
          </div>
        )}
        {messages.map(m => (
          <Message key={m.id} role={m.role} parts={m.parts as any[]} />
        ))}
        {status === 'submitted' && <div className="chat-thinking">thinking…</div>}
      </div>

      <div className="chat-input-wrap">
        {paletteOpen && (
          <SlashPalette
            query={input.slice(1)}
            onPick={pickPrebuilt}
            onClose={() => setPaletteOpen(false)}
          />
        )}
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Ask the agent — type / for shortcuts"
          value={input}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          disabled={status === 'streaming' || status === 'submitted'}
        />
      </div>
    </div>
  )
}

function Message({ role, parts }: { role: string; parts: any[] }) {
  const isUser = role === 'user'
  return (
    <div className={`chat-msg ${isUser ? 'user' : 'agent'}`}>
      <div className="chat-msg-role">{isUser ? 'you' : 'agent'}</div>
      <div className="chat-msg-body">
        {parts.map((p, i) => {
          if (p.type === 'text') {
            return <div key={i} className="chat-text">{p.text}</div>
          }
          if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
            const name = p.type.slice(5)
            const stateLabel =
              p.state === 'output-available' ? 'done'
              : p.state === 'input-available' ? 'running'
              : p.state === 'input-streaming' ? 'preparing'
              : p.state
            const detail =
              name === 'run_expansion' && p.input?.loss_spec
                ? ` · ${(p.input.loss_spec.terms ?? []).map((t: any) => `${t.name}=${t.weight}`).join(', ')}, ${p.input.steps ?? 30} steps`
                : name === 'define_loss' && p.input?.terms
                ? ` · ${(p.input.terms ?? []).map((t: any) => `${t.name}=${t.weight}`).join(', ')}`
                : ''
            return (
              <div key={i} className="chat-tool">
                <span className="chat-tool-name">{name}</span>
                <span className="chat-tool-state">{stateLabel}</span>
                <span className="chat-tool-detail">{detail}</span>
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

function SlashPalette({
  query, onPick, onClose,
}: { query: string; onPick: (p: Prebuilt) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    <div className="slash-palette" ref={ref}>
      <Command label="Prebuilt prompts">
        <Command.List>
          <Command.Empty>No matches.</Command.Empty>
          {PREBUILTS.map(p => (
            <Command.Item
              key={p.id}
              value={`${p.slash} ${p.label}`}
              onSelect={() => onPick(p)}
            >
              <span className="slash-key">{p.slash}</span>
              <span className="slash-label">{p.label}</span>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
      <div className="slash-foot">type to filter · enter to run · esc to close</div>
    </div>
  )
}
