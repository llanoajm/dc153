import type { Artifact } from "@/lib/artifacts"

// A renderer reads from `artifact.view_spec` (declarative spec the agent
// emits) and from `artifact.metadata` (file paths, source URLs, checksums).
// view_spec is intentionally untyped — each renderer narrows it itself so the
// platform can grow new spec fields without churning a central type.
export interface RendererProps {
  artifact: Artifact
}

// Spec for each built-in renderer (ROADMAP §11.6). Authors emit one of
// these on `artifact.view_spec` and the universal renderer routes by
// `view_spec.renderer` (or by `artifact.kind` as a default).
export type RendererName =
  | "markdown"
  | "table"
  | "chart"
  | "diff"
  | "code"
  | "file"
  | "log"
  | "dashboard"
  | "network-graph"

export const KIND_TO_RENDERER: Record<string, RendererName> = {
  source_document: "markdown",
  glossary: "markdown",
  context_doc: "markdown",
  report: "markdown",
  feature: "code",
  skill: "code",
  dataset: "table",
  run: "chart",
  network: "network-graph",
  view: "dashboard",
  panel: "dashboard",
  dashboard: "dashboard",
  chat: "log",
}

export function rendererFor(artifact: { kind: string; view_spec: Record<string, unknown> }): RendererName {
  const explicit = artifact.view_spec?.renderer
  if (typeof explicit === "string" && (explicit as RendererName)) {
    return explicit as RendererName
  }
  return KIND_TO_RENDERER[artifact.kind] ?? "file"
}
