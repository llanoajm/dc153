// Unit tests for lib/chat-upload.ts (LOOP_QUEUE.md item 7 — in-chat upload).
//
// Exercises the pure attachment helpers: supported-type detection, byte
// formatting, and the [attachments] encode/decode round-trip used to carry
// sent chips through the opencode transcript. No DOM / browser. Runner:
// `node --test tests/unit/chat-upload.test.mjs` from grid-app root. TS is
// loaded via jiti, same as the other unit tests.

import { test } from "node:test"
import assert from "node:assert/strict"
import { createJiti } from "jiti"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const jiti = createJiti(import.meta.url)
const mod = await jiti.import(path.resolve(__dirname, "../../lib/chat-upload.ts"))

const {
  ATTACHMENTS_PREFIX,
  isSupportedAttachment,
  formatBytes,
  encodeAttachments,
  splitAttachments,
} = mod

// ---------- isSupportedAttachment ----------

test("accepts known extensions regardless of mime", () => {
  assert.equal(isSupportedAttachment({ name: "deck.pdf" }), true)
  assert.equal(isSupportedAttachment({ name: "slides.PPTX" }), true)
  assert.equal(isSupportedAttachment({ name: "photo.JPG" }), true)
  assert.equal(isSupportedAttachment({ name: "clip.mp3" }), true)
})

test("falls back to mime prefix when extension is unknown", () => {
  assert.equal(isSupportedAttachment({ name: "blob", type: "application/pdf" }), true)
  assert.equal(isSupportedAttachment({ name: "blob", type: "image/heic" }), true)
  assert.equal(isSupportedAttachment({ name: "blob", type: "audio/x-aac" }), true)
})

test("rejects unsupported types", () => {
  assert.equal(isSupportedAttachment({ name: "data.csv" }), false)
  assert.equal(isSupportedAttachment({ name: "archive.zip", type: "application/zip" }), false)
  assert.equal(isSupportedAttachment({ name: "noext" }), false)
})

// ---------- formatBytes ----------

test("formatBytes scales to human units", () => {
  assert.equal(formatBytes(0), "0 B")
  assert.equal(formatBytes(512), "512 B")
  assert.equal(formatBytes(1024), "1 KB")
  assert.equal(formatBytes(1536), "1.5 KB")
  assert.equal(formatBytes(5 * 1024 * 1024), "5 MB")
})

// ---------- encode / split round-trip ----------

test("encodeAttachments returns the body unchanged when there are none", () => {
  assert.equal(encodeAttachments("hello", []), "hello")
})

test("encode then split recovers attachments and body", () => {
  const body = "summarize this report"
  const atts = [
    { filename: "report.pdf", artifactId: "11111111-1111-1111-1111-111111111111" },
    { filename: "chart.png", artifactId: "22222222-2222-2222-2222-222222222222" },
  ]
  const wire = encodeAttachments(body, atts)
  assert.ok(wire.startsWith(ATTACHMENTS_PREFIX))
  const out = splitAttachments(wire)
  assert.ok(out)
  assert.equal(out.body, body)
  assert.equal(out.attachments.length, 2)
  assert.deepEqual(out.attachments[0], atts[0])
  assert.deepEqual(out.attachments[1], atts[1])
})

test("splitAttachments returns null for a plain message", () => {
  assert.equal(splitAttachments("just a normal message"), null)
})

test("attachments-only message decodes to an empty body", () => {
  const wire = encodeAttachments("", [
    { filename: "a.pdf", artifactId: "33333333-3333-3333-3333-333333333333" },
  ])
  const out = splitAttachments(wire)
  assert.ok(out)
  assert.equal(out.body, "")
  assert.equal(out.attachments.length, 1)
})

test("a corrupt preamble is treated as no attachments", () => {
  const corrupt = `${ATTACHMENTS_PREFIX} {not json}\n\nbody text`
  assert.equal(splitAttachments(corrupt), null)
})

test("a body that merely mentions attachments is not parsed as a preamble", () => {
  assert.equal(splitAttachments("I uploaded [attachments] earlier"), null)
})
