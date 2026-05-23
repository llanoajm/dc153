import type { RendererProps } from "./types"

// Fallback renderer when nothing more specific matches. Surfaces what we know
// about the file (path, size, mime, source URL, license) plus a JSON inspect
// of view_spec + metadata so the agent's emitted shape is debuggable.
export function FileRenderer({ artifact }: RendererProps) {
  const meta = artifact.metadata
  const fields: Array<[string, string]> = []
  if (artifact.fs_path) fields.push(["fs_path", artifact.fs_path])
  if (artifact.storage_path) fields.push(["storage_path", artifact.storage_path])
  if (typeof meta.size === "number") fields.push(["size", `${meta.size} bytes`])
  if (typeof meta.mime === "string") fields.push(["mime", meta.mime])
  if (typeof meta.source_url === "string") fields.push(["source_url", meta.source_url])
  if (typeof meta.license === "string") fields.push(["license", meta.license])
  if (typeof meta.checksum === "string") fields.push(["checksum", meta.checksum])

  return (
    <div className="space-y-3">
      <div className="border border-black/10 divide-y divide-black/5">
        {fields.length === 0 ? (
          <div className="px-3 py-2 text-sm font-serif-soft text-black/50">
            No file metadata available.
          </div>
        ) : (
          fields.map(([k, v]) => (
            <div key={k} className="px-3 py-2 flex gap-3 text-sm">
              <span className="font-mark tracking-wider text-[11px] uppercase text-black/50 w-24 shrink-0">
                {k}
              </span>
              <span className="font-mono break-all">{v}</span>
            </div>
          ))
        )}
      </div>
      <details className="text-[11px] font-mono">
        <summary className="cursor-pointer text-black/50">raw artifact</summary>
        <pre className="mt-2 p-3 bg-black/[0.04] overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify({ view_spec: artifact.view_spec, metadata: artifact.metadata }, null, 2)}
        </pre>
      </details>
    </div>
  )
}
