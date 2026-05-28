import Link from "next/link"

// Creation-wizard placeholder (WORKSPACE_REDESIGN.md §5). The full wizard
// (name → focus multi-select → data source) is item 10 in REDESIGN_ROADMAP.md;
// this stub exists so the gallery's "New workspace" card resolves to a real
// route instead of a 404 in the interim.
export default function NewWorkspacePage() {
  return (
    <div className="mx-auto w-full max-w-md px-6 py-16 text-center">
      <h1 className="h-page-title" style={{ marginBottom: 8 }}>
        New workspace
      </h1>
      <p
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 14,
          lineHeight: 1.55,
          color: "var(--fg-mute)",
        }}
      >
        The creation wizard is coming next. You&rsquo;ll name the workspace,
        pick a focus, and anchor a grid.
      </p>
      <Link
        href="/app"
        className="inline-block mt-7"
        style={{
          fontFamily: "var(--font-sora)",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--ink-app)",
          border: "1px solid var(--bor-3)",
          borderRadius: "var(--r-3)",
          padding: "8px 16px",
        }}
      >
        Back to workspaces
      </Link>
    </div>
  )
}
