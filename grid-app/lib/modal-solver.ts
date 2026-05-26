import "server-only"

// Thin client for the Modal-hosted zap OPF solver
// (infra/modal/solver_app.py). The HTTP endpoint is created by
// `modal deploy` and its URL is injected via env at deploy time.
//
// Cold start ~20-40s for a fresh container; subsequent calls in the same
// container reuse the GPU. We don't pre-warm — see infra/modal/README.md for
// the cost rationale.

const ENDPOINT_URL = process.env.ZAP_SOLVER_MODAL_URL || ""
const API_KEY = process.env.ZAP_SOLVER_API_KEY || ""
const TIMEOUT_MS = Number(process.env.ZAP_SOLVER_TIMEOUT_MS || 600_000)

export interface SolveArgs {
  num_iterations?: number
  rho_power?: number
  rho_angle?: number
  atol?: number
  rtol?: number
  dtype?: "float32" | "float64"
}

export interface ImportArgs {
  power_unit?: number
  cost_unit?: number
  carbon_tax?: number
  scale_load?: number
  // Anything else accepted by zap.importers.pypsa.load_pypsa_network.
  [k: string]: unknown
}

export interface DispatchOutcomeSerialised {
  // Each is a nested list mirroring the torch tensor shape. `null` slots are
  // tolerated — the renderer treats every series as optional.
  power: unknown
  angle: unknown
  prices: unknown
}

export interface SolveResult {
  machine: "cuda" | "cpu"
  gpu: string | null
  elapsed_s: number
  time_horizon: number
  num_buses: number
  num_devices: number[]
  // Labels carried so callers can rebuild a CPU-shaped DispatchOutcome
  // without re-loading the upstream PyPSA network.
  bus_ids: string[]
  snapshot_iso: string[]
  device_class_names: string[]
  outcome: DispatchOutcomeSerialised
  solver_args: Record<string, unknown>
}

export class ModalSolverError extends Error {
  constructor(
    message: string,
    public status?: number,
    public cause?: unknown,
  ) {
    super(message)
    this.name = "ModalSolverError"
  }
}

/** Encode a PyPSA-netCDF buffer as base64 — Node 18+ has native support. */
function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}

export function modalSolverConfigured(): boolean {
  return Boolean(ENDPOINT_URL && API_KEY)
}

/**
 * Solve an OPF on the Modal-hosted GPU container.
 *
 * @param networkNetcdf PyPSA network exported via `Network.export_to_netcdf()`
 * @param args ADMM solver knobs (iterations, rho, tolerances)
 * @param importArgs zap.importers.pypsa.load_pypsa_network kwargs
 */
export async function solveOpfOnModal(
  networkNetcdf: Uint8Array,
  args: SolveArgs = {},
  importArgs: ImportArgs = {},
): Promise<SolveResult> {
  if (!modalSolverConfigured()) {
    throw new ModalSolverError(
      "Modal solver not configured. Set ZAP_SOLVER_MODAL_URL and ZAP_SOLVER_API_KEY.",
    )
  }

  const body = JSON.stringify({
    network_nc_b64: toB64(networkNetcdf),
    args,
    import_args: importArgs,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(ENDPOINT_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body,
    })
  } catch (e: unknown) {
    clearTimeout(timer)
    if (e instanceof Error && e.name === "AbortError") {
      throw new ModalSolverError(`solver timed out after ${TIMEOUT_MS}ms`)
    }
    throw new ModalSolverError("network error calling Modal solver", undefined, e)
  }
  clearTimeout(timer)

  const text = await res.text()
  if (!res.ok) {
    throw new ModalSolverError(
      `Modal solver returned ${res.status}: ${text.slice(0, 500)}`,
      res.status,
    )
  }

  let parsed: SolveResult
  try {
    parsed = JSON.parse(text) as SolveResult
  } catch (e) {
    throw new ModalSolverError("Modal solver returned non-JSON body", res.status, e)
  }
  return parsed
}
