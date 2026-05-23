"use client"

import Link from "next/link"
import { ChangeEvent, DragEvent, useCallback, useEffect, useState } from "react"
import type { Artifact } from "@/lib/artifacts"

// Sources panel: lists `kind='source_document'` artifacts and accepts a
// drag-and-drop PDF upload. Clicking a row navigates to the artifact viewer.
// Re-uploading a PDF with the same slug bumps `metadata.version` and chains
// `parent_id`; the ingestion script auto-emits a `diff` view spec.
export function SourcesPanel() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/artifacts?kind=source_document&limit=200")
      if (!r.ok) throw new Error(`list failed: ${r.status}`)
      setArtifacts(await r.json())
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Poll while any source is mid-pipeline so the user sees status transitions.
  useEffect(() => {
    if (!artifacts.some(isPipelineActive)) return
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [artifacts, refresh])

  const uploadOne = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
        setError(`only PDF uploads supported for now (got ${file.name})`)
        return
      }
      setUploading(true)
      setError(null)
      try {
        const form = new FormData()
        form.append("file", file, file.name)
        form.append("name", stripExt(file.name))
        const r = await fetch("/api/upload/pdf", { method: "POST", body: form })
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? `upload failed: ${r.status}`)
        }
        await refresh()
      } catch (e) {
        setError(String(e))
      } finally {
        setUploading(false)
      }
    },
    [refresh],
  )

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    for (const f of files) void uploadOne(f)
  }

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    for (const f of files) void uploadOne(f)
    e.currentTarget.value = ""
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-6">
        <div>
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Sources
          </div>
          <h1 className="font-serif-soft text-2xl mt-1">Source documents</h1>
          <p className="font-serif-soft text-sm text-black/60 mt-2 max-w-prose">
            Drop a PDF below to ingest. The pipeline extracts text, chunks it,
            stores embeddings, and merges any new domain terms into your{" "}
            <code className="font-mono text-[11px]">glossary.md</code> and{" "}
            <code className="font-mono text-[11px]">company-context.md</code> —
            both of which the agent auto-loads every session.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`border border-dashed px-4 py-8 text-center text-sm font-serif-soft transition-colors ${
            dragOver ? "border-black bg-black/[0.04] text-black" : "border-black/30 text-black/60"
          }`}
        >
          {uploading ? (
            <span>Uploading…</span>
          ) : (
            <>
              <div>Drag a PDF here</div>
              <label className="inline-block mt-3 text-xs font-mark tracking-wider underline cursor-pointer">
                or browse files
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="hidden"
                  onChange={onPick}
                />
              </label>
            </>
          )}
        </div>

        {error ? <div className="text-xs text-red-600 font-mono">{error}</div> : null}

        <div className="space-y-2">
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            {loading
              ? "Loading…"
              : `${artifacts.length} document${artifacts.length === 1 ? "" : "s"}`}
          </div>
          {artifacts.length === 0 && !loading ? (
            <div className="text-sm font-serif-soft text-black/50 px-2 py-6 text-center">
              No source documents yet. Drop a PDF above to start building your
              glossary and company-context docs.
            </div>
          ) : null}
          <ul className="border border-black/10 divide-y divide-black/5">
            {artifacts.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/app/artifacts/${a.id}`}
                  className="block px-4 py-3 hover:bg-black/[0.03] flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-serif-soft truncate">{a.name}</div>
                    <div className="text-[11px] font-mono text-black/40 truncate">
                      {sourceSubtitle(a)}
                    </div>
                  </div>
                  <StatusPill artifact={a} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function isPipelineActive(a: Artifact): boolean {
  const s = (a.metadata?.pipeline_status as string | undefined) ?? ""
  return s === "queued" || s === "extracting" || s === "chunking" || s === "embedded"
}

function sourceSubtitle(a: Artifact): string {
  const meta = a.metadata ?? {}
  const parts: string[] = []
  if (typeof meta.version === "number") parts.push(`v${meta.version}`)
  if (typeof meta.pages === "number") parts.push(`${meta.pages} pages`)
  if (typeof meta.chunks === "number") parts.push(`${meta.chunks} chunks`)
  if (typeof meta.glossary_terms_added === "number" && meta.glossary_terms_added > 0)
    parts.push(`+${meta.glossary_terms_added} terms`)
  if (a.slug) parts.push(a.slug)
  return parts.join(" · ") || (a.fs_path ?? "—")
}

function StatusPill({ artifact }: { artifact: Artifact }) {
  const pipeline = (artifact.metadata?.pipeline_status as string | undefined) ?? null
  const label = pipeline ?? artifact.status
  const tone =
    artifact.status === "failed_validation"
      ? "bg-red-100 text-red-700"
      : pipeline === "ready" || artifact.status === "canonical"
        ? "bg-emerald-100 text-emerald-700"
        : pipeline
          ? "bg-amber-100 text-amber-800"
          : "bg-black/[0.06] text-black/70"
  return <span className={`text-[10px] font-mono px-2 py-1 ${tone}`}>{label}</span>
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "")
}
