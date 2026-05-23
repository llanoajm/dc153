import type { RendererProps } from "./types"

// view_spec shape:
//   { renderer: "table", columns?: string[], rows: Array<Record<string, unknown>> | unknown[][] }
// rows can be column-name-keyed objects OR positional arrays paired with `columns`.
export function TableRenderer({ artifact }: RendererProps) {
  const spec = artifact.view_spec as {
    columns?: string[]
    rows?: unknown
  }
  const rows = Array.isArray(spec.rows) ? spec.rows : []
  if (rows.length === 0) {
    return (
      <div className="text-sm font-serif-soft text-black/50">
        Empty table. Set <code className="font-mono">view_spec.rows</code>.
      </div>
    )
  }
  const columns = inferColumns(spec.columns, rows)
  return (
    <div className="overflow-x-auto border border-black/10">
      <table className="w-full text-sm font-mono">
        <thead className="bg-black/[0.03] text-left">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-mark tracking-wider text-[11px] uppercase">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((row, i) => (
            <tr key={i} className="border-t border-black/5">
              {columns.map((c) => (
                <td key={c} className="px-3 py-2 align-top">
                  {formatCell(cellValue(row, c, columns))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 500 ? (
        <div className="px-3 py-2 text-[11px] text-black/50 font-serif-soft border-t border-black/5">
          Showing first 500 of {rows.length} rows.
        </div>
      ) : null}
    </div>
  )
}

function inferColumns(declared: string[] | undefined, rows: unknown[]): string[] {
  if (declared && declared.length > 0) return declared
  const first = rows[0]
  if (first && typeof first === "object" && !Array.isArray(first)) {
    return Object.keys(first as Record<string, unknown>)
  }
  if (Array.isArray(first)) return first.map((_, i) => String(i))
  return ["value"]
}

function cellValue(row: unknown, col: string, columns: string[]): unknown {
  if (row && typeof row === "object" && !Array.isArray(row)) {
    return (row as Record<string, unknown>)[col]
  }
  if (Array.isArray(row)) return row[columns.indexOf(col)]
  return row
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}
