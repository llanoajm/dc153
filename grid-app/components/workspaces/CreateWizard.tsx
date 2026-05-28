"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { FOCUS_TAGS } from "@/lib/workspaces-store"

// Creation wizard (WORKSPACE_REDESIGN.md §5; REDESIGN_ROADMAP §10):
// name → focus multi-select → data source (canonical template / defer) → create
// the workspace and land in its chat at /app/w/[id]. Focus is multi-select and
// is NOT cosmetic — it configures the zap planning problem later (§6); the
// data-source step anchors the workspace's single primary network (the
// permanent answer to "which network?").

export interface NetworkChoice {
  id: string
  name: string
  subtitle: string
}

type StepId = "name" | "focus" | "source"
const STEPS: { id: StepId; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "focus", label: "Focus" },
  { id: "source", label: "Data source" },
]

export function CreateWizard({ networks }: { networks: NetworkChoice[] }) {
  const router = useRouter()
  const [step, setStep] = useState<StepId>("name")
  const [name, setName] = useState("")
  const [focus, setFocus] = useState<string[]>([])
  const [networkId, setNetworkId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stepIndex = STEPS.findIndex((s) => s.id === step)
  const nameValid = name.trim().length > 0

  const toggleFocus = useCallback((id: string) => {
    setFocus((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id],
    )
  }, [])

  const create = useCallback(async () => {
    if (!nameValid || creating) return
    setCreating(true)
    setError(null)
    try {
      const r = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          focus,
          primary_network_id: networkId,
        }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.error ?? `create failed: ${r.status}`)
      }
      const ws = (await r.json()) as { id: string }
      router.push(`/app/w/${ws.id}`)
    } catch (e) {
      setError(String(e))
      setCreating(false)
    }
  }, [name, nameValid, focus, networkId, creating, router])

  const next = useCallback(() => {
    if (step === "name") {
      if (nameValid) setStep("focus")
    } else if (step === "focus") {
      setStep("source")
    }
  }, [step, nameValid])

  const back = useCallback(() => {
    if (step === "focus") setStep("name")
    else if (step === "source") setStep("focus")
  }, [step])

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <Stepper current={stepIndex} />

      {step === "name" ? (
        <Section
          title="Name your workspace"
          subtitle="A workspace anchors one grid and an intent. You can rename it later."
        >
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") next()
            }}
            placeholder="e.g. California decarbonization"
            className="w-full"
            style={inputStyle}
          />
        </Section>
      ) : null}

      {step === "focus" ? (
        <Section
          title="What's the focus?"
          subtitle="Pick one or more. This configures what the workspace optimizes — operations only, or which capacities it can plan. You can change it later."
        >
          <div className="grid gap-2.5 sm:grid-cols-2">
            {FOCUS_TAGS.map((tag) => {
              const selected = focus.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleFocus(tag.id)}
                  aria-pressed={selected}
                  className="text-left flex flex-col gap-1"
                  style={{
                    border: `1px solid ${selected ? "var(--ink-app)" : "var(--bor-3)"}`,
                    background: selected ? "var(--bg-tint-warm)" : "var(--bg-card)",
                    borderRadius: "var(--r-4)",
                    padding: "12px 14px",
                    transition: "border-color var(--t-hover), background var(--t-hover)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-sora)",
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "var(--ink-app)",
                    }}
                  >
                    {tag.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-sora)",
                      fontSize: 12,
                      lineHeight: 1.45,
                      color: "var(--fg-mute)",
                    }}
                  >
                    {tag.blurb}
                  </span>
                </button>
              )
            })}
          </div>
        </Section>
      ) : null}

      {step === "source" ? (
        <Section
          title="Anchor a grid"
          subtitle="Pick a reference network now, or skip and add one from the chat later (ask the agent to fetch one, or upload your own)."
        >
          <div className="flex flex-col gap-2">
            <SourceOption
              label="Skip for now"
              subtitle="Add a grid later from inside the workspace."
              selected={networkId === null}
              onClick={() => setNetworkId(null)}
            />
            {networks.map((n) => (
              <SourceOption
                key={n.id}
                label={n.name}
                subtitle={n.subtitle}
                selected={networkId === n.id}
                onClick={() => setNetworkId(n.id)}
              />
            ))}
            {networks.length === 0 ? (
              <p
                style={{
                  fontFamily: "var(--font-sora)",
                  fontSize: 12,
                  color: "var(--fg-mute-3)",
                  padding: "4px 2px",
                }}
              >
                No reference networks available yet — you can add one from the
                chat once the workspace is created.
              </p>
            ) : null}
          </div>
        </Section>
      ) : null}

      {error ? (
        <div
          className="mt-4"
          style={{ fontFamily: "var(--font-jetbrains)", fontSize: 12, color: "#b42318" }}
        >
          {error}
        </div>
      ) : null}

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={stepIndex === 0 ? () => router.push("/app") : back}
          style={ghostBtnStyle}
        >
          {stepIndex === 0 ? "Cancel" : "Back"}
        </button>

        {step === "source" ? (
          <button
            type="button"
            onClick={create}
            disabled={!nameValid || creating}
            style={primaryBtnStyle(!nameValid || creating)}
          >
            {creating ? "Creating…" : "Create workspace"}
          </button>
        ) : (
          <button
            type="button"
            onClick={next}
            disabled={step === "name" && !nameValid}
            style={primaryBtnStyle(step === "name" && !nameValid)}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  )
}

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((s, i) => {
        const active = i === current
        const done = i < current
        return (
          <div key={s.id} className="flex items-center gap-2">
            <span
              style={{
                fontFamily: "var(--font-jetbrains)",
                fontSize: 11,
                letterSpacing: "0.04em",
                color: active || done ? "var(--ink-app)" : "var(--fg-mute-4)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {i + 1}. {s.label}
            </span>
            {i < STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                style={{ width: 18, height: 1, background: "var(--bor-3)" }}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h1 className="h-page-title" style={{ marginBottom: 6 }}>
        {title}
      </h1>
      <p
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 14,
          lineHeight: 1.55,
          color: "var(--fg-mute)",
          maxWidth: 520,
          marginBottom: 22,
        }}
      >
        {subtitle}
      </p>
      {children}
    </div>
  )
}

function SourceOption({
  label,
  subtitle,
  selected,
  onClick,
}: {
  label: string
  subtitle: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="text-left flex flex-col gap-0.5"
      style={{
        border: `1px solid ${selected ? "var(--ink-app)" : "var(--bor-3)"}`,
        background: selected ? "var(--bg-tint-warm)" : "var(--bg-card)",
        borderRadius: "var(--r-4)",
        padding: "11px 14px",
        transition: "border-color var(--t-hover), background var(--t-hover)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 13.5,
          fontWeight: 600,
          color: "var(--ink-app)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-jetbrains)",
          fontSize: 11,
          color: "var(--fg-mute-2)",
        }}
      >
        {subtitle}
      </span>
    </button>
  )
}

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-sora)",
  fontSize: 15,
  color: "var(--ink-app)",
  background: "var(--bg-card)",
  border: "1px solid var(--bor-3)",
  borderRadius: "var(--r-3)",
  padding: "11px 14px",
  outline: "none",
}

const ghostBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-sora)",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--fg-mute)",
  background: "transparent",
  border: "1px solid var(--bor-3)",
  borderRadius: "var(--r-3)",
  padding: "8px 16px",
  cursor: "pointer",
}

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-sora)",
    fontSize: 13,
    fontWeight: 500,
    color: "#fff",
    background: disabled ? "var(--bor-4)" : "var(--ink-app)",
    border: "1px solid transparent",
    borderRadius: "var(--r-3)",
    padding: "8px 18px",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.85 : 1,
  }
}
