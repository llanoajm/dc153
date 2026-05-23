import "server-only"
import fs from "node:fs/promises"
import path from "node:path"

// Server-side PyPSA folder helpers: small RFC-4180 CSV parser plus a topology
// extractor that returns the shape the network-graph renderer expects. The
// pipeline scripts (Python) duplicate this logic for the upload pipeline; this
// module exists for the read-time API endpoint that serves the canonical
// reference networks (whose topology isn't yet embedded inline in view_spec).

export interface TopologyBus {
  id: string
  x?: number
  y?: number
  carrier?: string
}
export interface TopologyLine {
  source: string
  target: string
  s_nom?: number
  carrier?: string
}
export interface TopologyPayload {
  buses: TopologyBus[]
  lines: TopologyLine[]
  counts: { buses: number; lines: number; generators: number }
  truncated: boolean
}

const MAX_BUSES = 1500

export function parseCsv(input: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = []
  let field = ""
  let row: string[] = []
  let i = 0
  let inQuotes = false
  while (i < input.length) {
    const c = input[i]
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ",") {
      row.push(field)
      field = ""
      i++
      continue
    }
    if (c === "\n" || c === "\r") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      if (c === "\r" && input[i + 1] === "\n") i++
      i++
      continue
    }
    field += c
    i++
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  const header = rows.shift() ?? []
  // Drop trailing empty rows (file ending in newline).
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) rows.pop()
  return { header, rows }
}

function columnIndex(header: string[], names: string[]): number {
  for (const n of names) {
    const i = header.indexOf(n)
    if (i >= 0) return i
  }
  return -1
}

function toNumber(s: string | undefined): number | undefined {
  if (s === undefined || s === "") return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

export async function readPypsaTopology(folder: string): Promise<TopologyPayload> {
  const buses = await readBuses(path.join(folder, "buses.csv"))
  const lines = await readLines(path.join(folder, "lines.csv"))
  let generatorsCount = 0
  try {
    const genText = await fs.readFile(path.join(folder, "generators.csv"), "utf8")
    const { rows } = parseCsv(genText)
    generatorsCount = rows.length
  } catch {
    // generators.csv is optional; some MATPOWER-derived folders omit it
  }

  const counts = { buses: buses.length, lines: lines.length, generators: generatorsCount }
  if (buses.length <= MAX_BUSES) {
    return { buses, lines, counts, truncated: false }
  }
  // Downsample buses uniformly and drop lines whose endpoints leave the sample.
  const stride = Math.ceil(buses.length / MAX_BUSES)
  const kept = new Map<string, TopologyBus>()
  for (let i = 0; i < buses.length; i += stride) {
    kept.set(buses[i].id, buses[i])
  }
  const filteredLines = lines.filter((l) => kept.has(l.source) && kept.has(l.target))
  return {
    buses: [...kept.values()],
    lines: filteredLines,
    counts,
    truncated: true,
  }
}

async function readBuses(file: string): Promise<TopologyBus[]> {
  const text = await fs.readFile(file, "utf8")
  const { header, rows } = parseCsv(text)
  const iName = columnIndex(header, ["name", "Bus"])
  const iX = columnIndex(header, ["x"])
  const iY = columnIndex(header, ["y"])
  const iCarrier = columnIndex(header, ["carrier"])
  return rows
    .filter((r) => iName < r.length && r[iName] !== "")
    .map((r) => {
      const bus: TopologyBus = { id: String(r[iName]) }
      if (iX >= 0) {
        const v = toNumber(r[iX])
        if (v !== undefined) bus.x = v
      }
      if (iY >= 0) {
        const v = toNumber(r[iY])
        if (v !== undefined) bus.y = v
      }
      if (iCarrier >= 0 && r[iCarrier]) bus.carrier = r[iCarrier]
      return bus
    })
}

async function readLines(file: string): Promise<TopologyLine[]> {
  let text: string
  try {
    text = await fs.readFile(file, "utf8")
  } catch {
    return []
  }
  const { header, rows } = parseCsv(text)
  const iSource = columnIndex(header, ["bus0", "Bus0", "from", "from_bus"])
  const iTarget = columnIndex(header, ["bus1", "Bus1", "to", "to_bus"])
  const iSnom = columnIndex(header, ["s_nom"])
  const iCarrier = columnIndex(header, ["carrier"])
  if (iSource < 0 || iTarget < 0) return []
  return rows
    .filter((r) => r[iSource] !== "" && r[iTarget] !== "")
    .map((r) => {
      const line: TopologyLine = {
        source: String(r[iSource]),
        target: String(r[iTarget]),
      }
      if (iSnom >= 0) {
        const v = toNumber(r[iSnom])
        if (v !== undefined) line.s_nom = v
      }
      if (iCarrier >= 0 && r[iCarrier]) line.carrier = r[iCarrier]
      return line
    })
}

// Resolve fs_path against the repo (relative) or use absolute as-is.
export function resolveFsPath(fsPath: string): string {
  if (path.isAbsolute(fsPath)) return fsPath
  return path.join(process.cwd(), fsPath)
}
