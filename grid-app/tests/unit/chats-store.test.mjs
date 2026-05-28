// Unit tests for lib/chats-store.ts (LOOP_QUEUE.md item 4 — chat persistence).
//
// Drives the pure / injectable store layer with a fake Supabase-shaped client
// backed by an in-memory array, so create → list → reopen is exercised with no
// DB. Runner: `node --test tests/unit/chats-store.test.mjs` from grid-app root.
// TS is loaded via jiti (a transitive Next.js dep), same as the bearer test.

import { test } from "node:test"
import assert from "node:assert/strict"
import { createJiti } from "jiti"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const jiti = createJiti(import.meta.url)
const mod = await jiti.import(path.resolve(__dirname, "../../lib/chats-store.ts"))

const {
  deriveChatTitle,
  createChatWith,
  listChatsWith,
  getChatWith,
  touchChatWith,
} = mod

// ---- in-memory fake of the narrow Supabase surface the store uses ----
function makeFakeDb() {
  const rows = []
  let seq = 0
  return {
    _rows: rows,
    from(table) {
      assert.equal(table, "chats")
      return {
        insert(row) {
          return {
            select() {
              return {
                async single() {
                  const now = new Date(Date.now() + seq).toISOString()
                  seq += 1
                  const full = {
                    id: `chat-${rows.length + 1}`,
                    workspace_id: row.workspace_id ?? null,
                    user_id: row.user_id ?? null,
                    org_id: row.org_id ?? null,
                    session_id: row.session_id,
                    title: row.title,
                    created_at: now,
                    updated_at: now,
                    last_message_at: row.last_message_at ?? now,
                  }
                  rows.push(full)
                  return { data: full, error: null }
                },
              }
            },
          }
        },
        select() {
          return {
            eq(col, val) {
              const matches = rows.filter((r) => r[col] === val)
              return {
                async order(orderCol, { ascending }) {
                  const sorted = matches.slice().sort((a, b) => {
                    const av = a[orderCol]
                    const bv = b[orderCol]
                    return ascending ? (av < bv ? -1 : 1) : av < bv ? 1 : -1
                  })
                  return { data: sorted, error: null }
                },
                async maybeSingle() {
                  return { data: matches[0] ?? null, error: null }
                },
              }
            },
          }
        },
        update(patch) {
          return {
            async eq(col, val) {
              for (const r of rows) {
                if (r[col] === val) Object.assign(r, patch)
              }
              return { error: null }
            },
          }
        },
      }
    },
  }
}

// ---------- deriveChatTitle (pure) ----------

test("deriveChatTitle returns default for empty/undefined", () => {
  assert.equal(deriveChatTitle(undefined), "New chat")
  assert.equal(deriveChatTitle("   "), "New chat")
})

test("deriveChatTitle collapses whitespace and trims", () => {
  assert.equal(deriveChatTitle("  plan   the\n grid  "), "plan the grid")
})

test("deriveChatTitle strips the [active-network] preamble", () => {
  const msg =
    '[active-network] "IEEE 30" (network_artifact_id: x) — use this.\n\nrun a dispatch'
  assert.equal(deriveChatTitle(msg), "run a dispatch")
})

test("deriveChatTitle truncates long messages with an ellipsis", () => {
  const long = "a".repeat(200)
  const t = deriveChatTitle(long)
  assert.equal(t.length, 80)
  assert.ok(t.endsWith("…"))
})

// ---------- create → list → reopen ----------

test("create persists a chat with a derived title", async () => {
  const db = makeFakeDb()
  const chat = await createChatWith(db, {
    workspace_id: "ws-1",
    session_id: "ses-abc",
    user_id: "user-1",
    first_message: "plan some generation expansion",
  })
  assert.equal(chat.workspace_id, "ws-1")
  assert.equal(chat.session_id, "ses-abc")
  assert.equal(chat.user_id, "user-1")
  assert.equal(chat.org_id, null)
  assert.equal(chat.title, "plan some generation expansion")
  assert.equal(db._rows.length, 1)
})

test("org-owned chat nulls user_id", async () => {
  const db = makeFakeDb()
  const chat = await createChatWith(db, {
    workspace_id: "ws-1",
    session_id: "ses-org",
    user_id: "user-1",
    org_id: "org-9",
    title: "Org chat",
  })
  assert.equal(chat.org_id, "org-9")
  assert.equal(chat.user_id, null)
})

test("list returns a workspace's chats most-recent first", async () => {
  const db = makeFakeDb()
  await createChatWith(db, {
    workspace_id: "ws-1",
    session_id: "s1",
    user_id: "u1",
    title: "first",
  })
  await createChatWith(db, {
    workspace_id: "ws-1",
    session_id: "s2",
    user_id: "u1",
    title: "second",
  })
  await createChatWith(db, {
    workspace_id: "ws-other",
    session_id: "s3",
    user_id: "u1",
    title: "elsewhere",
  })
  const list = await listChatsWith(db, "ws-1")
  assert.equal(list.length, 2)
  // most-recent first: "second" was created after "first"
  assert.deepEqual(
    list.map((c) => c.title),
    ["second", "first"],
  )
})

test("reopen: getChat returns the row with its session id", async () => {
  const db = makeFakeDb()
  const created = await createChatWith(db, {
    workspace_id: "ws-1",
    session_id: "ses-reopen",
    user_id: "u1",
    title: "reopen me",
  })
  const fetched = await getChatWith(db, created.id)
  assert.ok(fetched)
  assert.equal(fetched.id, created.id)
  assert.equal(fetched.session_id, "ses-reopen")
  assert.equal(fetched.title, "reopen me")
})

test("getChat returns null for an unknown id", async () => {
  const db = makeFakeDb()
  assert.equal(await getChatWith(db, "nope"), null)
})

test("touch bumps last_message_at so the chat floats up the list", async () => {
  const db = makeFakeDb()
  const a = await createChatWith(db, {
    workspace_id: "ws-1",
    session_id: "sa",
    user_id: "u1",
    title: "A",
  })
  await createChatWith(db, {
    workspace_id: "ws-1",
    session_id: "sb",
    user_id: "u1",
    title: "B",
  })
  // B is newest → list is [B, A]
  let list = await listChatsWith(db, "ws-1")
  assert.deepEqual(list.map((c) => c.title), ["B", "A"])
  // touching A should float it to the top
  await new Promise((r) => setTimeout(r, 2))
  await touchChatWith(db, a.id)
  list = await listChatsWith(db, "ws-1")
  assert.deepEqual(list.map((c) => c.title), ["A", "B"])
})
