// Unit tests for lib/bearer-token-validation.ts (LOOP_QUEUE.md item 10.1).
//
// Runner: `node --test tests/unit/bearer-token-validation.test.mjs` from the
// grid-app root. We load the TS source via jiti (already a transitive dep of
// Next.js) so this file doesn't need a separate transpile step.

import { test } from "node:test"
import assert from "node:assert/strict"
import { createJiti } from "jiti"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const jiti = createJiti(import.meta.url)
const mod = await jiti.import(
  path.resolve(__dirname, "../../lib/bearer-token-validation.ts"),
)

const { validateBearerToken, sanitizeBearerTokenEnv } = mod

const CLEAN_HEX_64 =
  "87ab9d34ef0e4a351243d17fc3863ea981e2666e74c1d446914ca0be67a513cb"

test("clean 64-char hex token is accepted unchanged", () => {
  const r = validateBearerToken(CLEAN_HEX_64)
  assert.equal(r.ok, true)
  assert.equal(r.value, CLEAN_HEX_64)
  assert.equal(r.trimmed, false)
})

test("trailing whitespace is trimmed and accepted", () => {
  const r = validateBearerToken(`${CLEAN_HEX_64}   \t\n`)
  assert.equal(r.ok, true)
  assert.equal(r.value, CLEAN_HEX_64)
  assert.equal(r.trimmed, true)
})

test("leading whitespace is trimmed and accepted", () => {
  const r = validateBearerToken(`\n  ${CLEAN_HEX_64}`)
  assert.equal(r.ok, true)
  assert.equal(r.value, CLEAN_HEX_64)
  assert.equal(r.trimmed, true)
})

test("embedded U+2502 (the actual incident character) is rejected", () => {
  const polluted = `${CLEAN_HEX_64} │`
  const r = validateBearerToken(polluted)
  assert.equal(r.ok, false)
  assert.match(r.reason, /U\+2502/)
})

test("other non-ASCII characters are rejected", () => {
  const r = validateBearerToken(`${CLEAN_HEX_64}é`)
  assert.equal(r.ok, false)
  assert.match(r.reason, /non-ASCII/)
})

test("uppercase hex is rejected (lowercase only — matches openssl rand -hex)", () => {
  const r = validateBearerToken(CLEAN_HEX_64.toUpperCase())
  assert.equal(r.ok, false)
  assert.match(r.reason, /hex/i)
})

test("short tokens (<32 chars) are rejected", () => {
  const r = validateBearerToken("abc123")
  assert.equal(r.ok, false)
})

test("empty string is rejected", () => {
  const r = validateBearerToken("")
  assert.equal(r.ok, false)
  assert.match(r.reason, /empty/)
})

test("undefined / null are rejected", () => {
  assert.equal(validateBearerToken(undefined).ok, false)
  assert.equal(validateBearerToken(null).ok, false)
})

test("whitespace-only is rejected", () => {
  const r = validateBearerToken("   \t\n")
  assert.equal(r.ok, false)
})

test("sanitizeBearerTokenEnv scrubs polluted process.env value", () => {
  const KEY = "__STEINMETZ_TEST_TOKEN_POLLUTED__"
  const originalCwd = process.cwd()
  try {
    process.chdir("/tmp")
    process.env[KEY] = `${CLEAN_HEX_64} │`
    const out = sanitizeBearerTokenEnv(KEY)
    assert.equal(out, undefined)
    assert.equal(process.env[KEY], undefined)
  } finally {
    delete process.env[KEY]
    process.chdir(originalCwd)
  }
})

test("sanitizeBearerTokenEnv passes through clean value unchanged", () => {
  const KEY = "__STEINMETZ_TEST_TOKEN_CLEAN__"
  try {
    process.env[KEY] = CLEAN_HEX_64
    const out = sanitizeBearerTokenEnv(KEY)
    assert.equal(out, CLEAN_HEX_64)
    assert.equal(process.env[KEY], CLEAN_HEX_64)
  } finally {
    delete process.env[KEY]
  }
})

test("sanitizeBearerTokenEnv returns undefined for absent env var", () => {
  const KEY = "__STEINMETZ_TEST_TOKEN_MISSING__"
  delete process.env[KEY]
  assert.equal(sanitizeBearerTokenEnv(KEY), undefined)
})
