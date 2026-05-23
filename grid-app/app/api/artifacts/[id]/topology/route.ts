import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getArtifact } from "@/lib/artifacts"
import { readPypsaTopology, resolveFsPath } from "@/lib/pypsa-folder"

// Topology endpoint for the network-graph renderer. Returns parsed bus/line
// data from the PyPSA CSV folder at the artifact's fs_path. The renderer
// prefers inline topology embedded in view_spec; this is the fallback for
// artifacts (e.g. seeded canonical reference networks) whose topology isn't
// inlined.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await ctx.params
  const artifact = await getArtifact(id)
  if (!artifact) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (!artifact.fs_path) {
    return NextResponse.json({ error: "artifact has no fs_path" }, { status: 422 })
  }

  try {
    const topology = await readPypsaTopology(resolveFsPath(artifact.fs_path))
    return NextResponse.json(topology)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
