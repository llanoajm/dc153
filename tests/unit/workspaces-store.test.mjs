// Unit tests for lib/workspaces-store.ts (LOOP_QUEUE.md item 10 — creation
// wizard). Covers the create-workspace happy path (and the focus sanitizer the
// wizard relies on) by driving the pure / injectable store layer with a fake
// Supabase-shaped client backed by an in-memory array — no DB.
// Runner: `node --test tests/unit/workspaces-store.test.mjs` from grid-app root.
// TS is loaded via jiti (a transitive Next.js dep), same as the other unit tests.

import { test } from "node:test"
import assert from "node:assert/strict"
import { createJiti } from "jiti"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const jiti = createJiti(import.meta.url)
const mod = await jiti.import(path.resolve(__dirname, "../../lib/workspaces-store.ts"))

const { createWorkspaceWith, sanitizeFocus, FOCUS_TAGS } = mod

// ---- in-memory fake of the narrow Supabase surface the store uses ----
function makeFakeDb() {
  const rows = []
  return {
    _rows: rows,
    from(table) {
      assert.equal(table, "workspaces")
      return {
        insert(row) {
          return {
            select() {
              return {
                async single() {
                  const now = new Date().toISOString()
                  const full = {
                    id: `ws-${rows.length + 1}`,
                    user_id: row.user_id ?? null,
                    org_id: row.org_id ?? null,
                    name: row.name,
                    focus: row.focus ?? [],
                    primary_network_id: row.primary_network_id ?? null,
                    cover_image_url: row.cover_image_url ?? null,
                    created_at: now,
                    updated_at: now,
                  }
                  rows.push(full)
                  return { data: full, error: null }
                },
              }
            },
          }
        },
      }
    },
  }
}

// ---------- create-workspace happy path ----------

test("create persists a personal workspace with name + focus + primary network", async () => {
  const db = makeFakeDb()
  const ws = await createWorkspaceWith(db, {
    name: "California decarbonization",
    user_id: "user-1",
    focus: ["Generation", "Decarbonization"],
    primary_network_id: "net-abc",
  })
  assert.equal(ws.id, "ws-1")
  assert.equal(ws.name, "California decarbonization")
  assert.equal(ws.user_id, "user-1")
  assert.equal(ws.org_id, null)
  assert.deepEqual(ws.focus, ["Generation", "Decarbonization"])
  assert.equal(ws.primary_network_id, "net-abc")
  assert.equal(db._rows.length, 1)
})

test("name is trimmed and falls back to a default when blank", async () => {
  const db = makeFakeDb()
  const trimmed = await createWorkspaceWith(db, { name: "  My grid  ", user_id: "u" })
  assert.equal(trimmed.name, "My grid")
  const blank = await createWorkspaceWith(db, { name: "   ", user_id: "u" })
  assert.equal(blank.name, "Untitled workspace")
})

test("defer-source workspace has a null primary network and empty focus", async () => {
  const db = makeFakeDb()
  const ws = await createWorkspaceWith(db, { name: "Scratch", user_id: "u" })
  assert.equal(ws.primary_network_id, null)
  assert.deepEqual(ws.focus, [])
})

test("org-owned workspace nulls user_id (one-owner check)", async () => {
  const db = makeFakeDb()
  const ws = await createWorkspaceWith(db, {
    name: "Team grid",
    user_id: "user-1",
    org_id: "org-9",
  })
  assert.equal(ws.org_id, "org-9")
  assert.equal(ws.user_id, null)
})

test("create surfaces the db error", async () => {
  const db = {
    from() {
      return {
        insert() {
          return {
            select() {
              return { async single() {
                return { data: null, error: { message: "rls denied" } }
              } }
            },
          }
        },
      }
    },
  }
  await assert.rejects(
    () => createWorkspaceWith(db, { name: "x", user_id: "u" }),
    /rls denied/,
  )
})

// ---------- focus sanitizer (the wizard's multi-select feeds this) ----------

test("sanitizeFocus keeps only known tags, de-duplicated and order-preserving", () => {
  const known = FOCUS_TAGS.map((t) => t.id)
  assert.ok(known.includes("Generation"))
  assert.deepEqual(
    sanitizeFocus(["Generation", "bogus", "Decarbonization", "Generation"]),
    ["Generation", "Decarbonization"],
  )
})

test("sanitizeFocus returns [] for non-arrays / junk", () => {
  assert.deepEqual(sanitizeFocus(undefined), [])
  assert.deepEqual(sanitizeFocus("Generation"), [])
  assert.deepEqual(sanitizeFocus([1, 2, {}]), [])
})

test("focus written to the row is sanitized (junk dropped on create)", async () => {
  const db = makeFakeDb()
  const ws = await createWorkspaceWith(db, {
    name: "Filtered",
    user_id: "u",
    focus: ["Operations", "not-a-tag"],
  })
  assert.deepEqual(ws.focus, ["Operations"])
})
