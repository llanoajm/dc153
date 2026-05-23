// Shared types for the workspace shell. Lives here (not on WorkspaceShell.tsx)
// so LeftRail can import the type without creating a circular module cycle.
export interface PinnedDashboard {
  id: string
  name: string
}
