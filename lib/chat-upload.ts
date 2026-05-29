// In-chat file upload (WORKSPACE_REDESIGN §10, REDESIGN_ROADMAP item 7).
//
// Pure, framework-free helpers shared by the composer's attach control and the
// message renderer. Kept out of the React component so the upload/encoding
// logic is unit-testable under node's test runner (no DOM), mirroring the
// `lib/chats-store.ts` split.
//
// Wire-up: the composer uploads each attached file through the existing
// `/api/upload/source` route (returns a `source_document` artifact, so the file
// also surfaces in the Sources tab). Sent attachments are encoded into the
// message text as an `[attachments]` preamble — the same trick the
// `[active-network]` context line uses — so the persisted opencode transcript
// carries the chips and re-renders them on reload. `splitAttachments` strips the
// preamble back out for display.

export type AttachmentStatus = "uploading" | "ready" | "error"

// A file the user has attached in the composer (before send).
export interface PendingAttachment {
  // Stable client id so React keys + status updates are addressable.
  localId: string
  filename: string
  bytes: number
  status: AttachmentStatus
  // The artifact id assigned once `/api/upload/source` returns 201.
  artifactId?: string
  error?: string
}

// The compact shape embedded in the sent message + parsed back for display.
export interface SentAttachment {
  filename: string
  artifactId: string
}

export const ATTACHMENTS_PREFIX = "[attachments]"

// Mirror of app/api/upload/source/route.ts EXT_MAP — the supported source
// kinds. Kept here (not imported from the route) so this module stays
// server-runtime-free and testable.
const SUPPORTED_EXTS = new Set([
  ".pdf",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".oga",
  ".flac",
])

// The `accept` attribute for the composer's hidden file input.
export const ATTACH_ACCEPT =
  "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx,image/*,audio/*"

// Minimal File shape so this is testable without the DOM `File` global.
export interface FileLike {
  name: string
  type?: string
  size?: number
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".")
  return i >= 0 ? name.slice(i).toLowerCase() : ""
}

// True when the upload route will accept this file. Matches the route's
// detectKind: extension first, then a mime-prefix fallback.
export function isSupportedAttachment(file: FileLike): boolean {
  if (SUPPORTED_EXTS.has(extOf(file.name))) return true
  const type = (file.type || "").toLowerCase()
  if (type === "application/pdf") return true
  if (
    type ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  )
    return true
  if (type.startsWith("image/") || type.startsWith("audio/")) return true
  return false
}

// A short human label for a byte count, for the chip subtitle.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let n = bytes
  let u = 0
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024
    u += 1
  }
  const rounded = n >= 10 || u === 0 ? Math.round(n) : Math.round(n * 10) / 10
  return `${rounded} ${units[u]}`
}

// Encode the message body + its ready attachments into the wire text. Returns
// the body unchanged when there are no attachments, so plain messages are
// byte-identical to today's. The preamble is one JSON line followed by a blank
// line, then the user's text — same layout as the network-context line so the
// two can't be confused (different prefix) and either/both can lead a message.
export function encodeAttachments(
  body: string,
  attachments: SentAttachment[],
): string {
  if (attachments.length === 0) return body
  const payload = attachments.map((a) => ({
    filename: a.filename,
    artifact_id: a.artifactId,
  }))
  return `${ATTACHMENTS_PREFIX} ${JSON.stringify(payload)}\n\n${body}`
}

// Parse the `[attachments]` preamble back out for display. Returns null when
// the text has no attachment preamble (the common case). Tolerant of malformed
// JSON — a corrupt preamble is treated as no attachments rather than throwing.
export function splitAttachments(
  text: string,
): { attachments: SentAttachment[]; body: string } | null {
  if (!text.startsWith(ATTACHMENTS_PREFIX)) return null
  const nl = text.indexOf("\n")
  if (nl < 0) return null
  const firstLine = text.slice(ATTACHMENTS_PREFIX.length, nl).trim()
  // Body is everything after the blank line that follows the preamble line.
  let body = text.slice(nl + 1)
  if (body.startsWith("\n")) body = body.slice(1)
  let parsed: unknown
  try {
    parsed = JSON.parse(firstLine)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const attachments: SentAttachment[] = []
  for (const item of parsed) {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>
      const filename = typeof rec.filename === "string" ? rec.filename : null
      const artifactId =
        typeof rec.artifact_id === "string" ? rec.artifact_id : null
      if (filename && artifactId) {
        attachments.push({ filename, artifactId })
      }
    }
  }
  if (attachments.length === 0) return null
  return { attachments, body }
}
