"use client"

import Link from "next/link"
import { DragEvent, useCallback, useEffect, useState } from "react"
import type { Artifact } from "@/lib/artifacts"

// Networks panel: lists `kind='network'` artifacts (canonical + uploaded) and
// accepts a drag-and-drop PyPSA folder upload. Clicking a row navigates to
// `/app/artifacts/<id>` which renders via the universal artifact viewer (which
// dispatches to the network-graph renderer).

export function NetworksPanel() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/artifacts?kind=network&limit=200")
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

  // Light polling so the UI shows status transitions (queued → ready) without
  // the user having to refresh. The page-level polling is bounded by tab
  // visibility.
  useEffect(() => {
    if (!artifacts.some((a) => isPipelineActive(a))) return
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [artifacts, refresh])

  const onUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setUploading(true)
      setError(null)
      try {
        const form = new FormData()
        const inferredName = inferNetworkName(files)
        form.append("name", inferredName)
        form.append("slug", "")
        for (const f of files) form.append("files", f, fileLabel(f))
        const r = await fetch("/api/upload", { method: "POST", body: form })
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
    const items = e.dataTransfer.items
    if (items?.length) {
      // Try to read entries (supports dropping a folder in Chromium-based browsers).
      const filePromises: Promise<File[]>[] = []
      for (const item of Array.from(items)) {
        const entry = item.webkitGetAsEntry?.()
        if (entry) {
          filePromises.push(walkEntry(entry))
        } else {
          const f = item.getAsFile()
          if (f) filePromises.push(Promise.resolve([f]))
        }
      }
      Promise.all(filePromises).then((groups) => onUpload(groups.flat()))
      return
    }
    const files = Array.from(e.dataTransfer.files ?? [])
    onUpload(files)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-6">
        <div>
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            Networks
          </div>
          <h1 className="font-soft text-2xl mt-1">Power-system networks</h1>
          <p className="font-soft text-sm text-black/60 mt-2 max-w-prose">
            Canonical reference networks ship with the product. Drop a PyPSA CSV folder
            (or a .zip of one) below to ingest your own — the file is written into your
            workspace and a 1-hour smoke dispatch runs in the background.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`border border-dashed px-4 py-8 text-center text-sm font-soft transition-colors ${
            dragOver ? "border-black bg-black/[0.04] text-black" : "border-black/30 text-black/60"
          }`}
        >
          {uploading ? (
            <span>Uploading…</span>
          ) : (
            <>
              <div>Drag a PyPSA folder here</div>
              <label className="inline-block mt-3 text-xs font-mark tracking-wider underline cursor-pointer">
                or browse files
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    if (files.length) onUpload(files)
                    e.currentTarget.value = ""
                  }}
                />
              </label>
            </>
          )}
        </div>

        {error ? (
          <div className="text-xs text-red-600 font-mono">{error}</div>
        ) : null}

        <div className="space-y-2">
          <div className="text-[11px] font-mark tracking-wider uppercase text-black/50">
            {loading ? "Loading…" : `${artifacts.length} network${artifacts.length === 1 ? "" : "s"}`}
          </div>
          {artifacts.length === 0 && !loading ? (
            <div className="text-sm font-soft text-black/50 px-2 py-6 text-center">
              No networks yet. The canonical reference networks should appear here once
              the schema has been applied in Supabase.
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
                    <div className="text-sm font-soft truncate">{a.name}</div>
                    <div className="text-[11px] font-mono text-black/40 truncate">
                      {networkSubtitle(a)}
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
  return s === "queued" || s === "extracting" || s === "embedded"
}

function networkSubtitle(a: Artifact): string {
  const meta = a.metadata ?? {}
  const parts: string[] = []
  if (typeof meta.buses === "number") parts.push(`${meta.buses} buses`)
  if (typeof meta.lines === "number") parts.push(`${meta.lines} lines`)
  if (typeof meta.generators === "number") parts.push(`${meta.generators} generators`)
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
  return (
    <span className={`text-[10px] font-mono px-2 py-1 ${tone}`}>{label}</span>
  )
}

function inferNetworkName(files: File[]): string {
  // If one of the files is a zip, use its basename; if multiple CSVs, use the
  // parent folder name when available; otherwise generic.
  const zip = files.find((f) => f.name.toLowerCase().endsWith(".zip"))
  if (zip) return zip.name.replace(/\.zip$/i, "")
  for (const f of files) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath
    if (rel && rel.includes("/")) return rel.split("/")[0]
  }
  return "Uploaded network"
}

function fileLabel(f: File): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath
  // Strip the wrapper directory so files land in <rawDir>/<basename>; the
  // ingestion script handles wrapper folders.
  if (rel && rel.includes("/")) {
    return rel.split("/").slice(1).join("_") || f.name
  }
  return f.name
}

// Recursively read a DataTransferItemList entry (works for dropped folders).
async function walkEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    return new Promise((resolve) => fileEntry.file((f) => resolve([f])))
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()
    const out: File[] = []
    const readBatch = (): Promise<void> =>
      new Promise((resolve) =>
        reader.readEntries(async (entries) => {
          if (entries.length === 0) {
            resolve()
            return
          }
          for (const e of entries) {
            const files = await walkEntry(e)
            out.push(...files)
          }
          // readEntries returns chunks; keep reading until empty.
          await readBatch()
          resolve()
        }),
      )
    await readBatch()
    return out
  }
  return []
}
