#!/usr/bin/env bash
# Steinmetz ralph-loop: drives LOOP_QUEUE.md items autonomously.
# Reads ROADMAP.md / STATE.md / AGENTS.md as authoritative context
# (does not restructure them). Per-iteration handoff in LOOP_HANDOFF.md.
# Every iteration ends with a standardized tag commit + push (if remote).
set -uo pipefail

# --- Config ------------------------------------------------------------------
QUEUE=LOOP_QUEUE.md
HANDOFF=LOOP_HANDOFF.md
JOURNAL=LOOP_JOURNAL.md
ALERTS=LOOP_ALERTS.md
ATTEMPTS_DIR=.loop-attempts

MODEL="claude-opus-4-7"
WORK_TIMEOUT=30m
VERIFY_TIMEOUT=10m
MAX_ATTEMPTS=5
MAX_TOTAL_ITERS=200
SLEEP_BETWEEN=5
BUDGET_FLAGS=()   # e.g. (--max-budget-usd 3)

# --- Pre-flight --------------------------------------------------------------
[ -f "$QUEUE" ] || { echo "Missing $QUEUE in $(pwd)"; exit 1; }
[ -f ROADMAP.md ] || { echo "Run from a directory containing ROADMAP.md"; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 \
  || { echo "Not a git repo."; exit 1; }
command -v claude >/dev/null \
  || { echo "'claude' CLI not on PATH."; exit 1; }
command -v timeout >/dev/null \
  || { echo "'timeout' not on PATH (install GNU coreutils)."; exit 1; }

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: working tree is dirty. The loop uses 'git reset --hard' for rollback —"
  echo "       any uncommitted changes would be destroyed on a failed verify."
  echo "       Commit or stash first, then re-run:"
  echo "         git add -A && git commit -m 'baseline before ralph-loop'"
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  HAS_REMOTE=1
  echo "Remote 'origin' detected: $(git remote get-url origin) — iterations will be pushed."
else
  HAS_REMOTE=0
  echo "No 'origin' remote — iterations will commit locally only."
fi

if ! ss -tlnp 2>/dev/null | grep -qE ':3000|:4096'; then
  echo "WARN: Next dev (3000) or opencode (4096) not detected. See AGENTS.md Quick Start."
  echo "      Continuing in 5s; Ctrl-C to abort."
  sleep 5
fi

mkdir -p "$ATTEMPTS_DIR"
touch "$JOURNAL" "$ALERTS"

# --- Helpers -----------------------------------------------------------------
next_queue_line() { grep -n '^- \[ \]' "$QUEUE" | head -1; }
read_field() {
  grep -i "^$1:" "$HANDOFF" 2>/dev/null | tail -1 | sed "s/^$1://i" | xargs
}
extract_feature_num() {
  echo "$1" | grep -oE '[0-9]+' | head -1
}
truncate_to() {
  local max="$1"; local s="$2"
  if [ "${#s}" -gt "$max" ]; then echo "${s:0:$((max-1))}…"; else echo "$s"; fi
}

# Push current branch if a remote is configured; never fail the loop on push errors.
push_if_remote() {
  [ "$HAS_REMOTE" = 1 ] || return 0
  local branch; branch=$(git rev-parse --abbrev-ref HEAD)
  git push -u origin "$branch" >/dev/null 2>&1 \
    || echo "[$(date -Iseconds)] WARN: push failed for $branch" >> "$ALERTS"
}

# Stage and commit all LOOP_* files (plus anything else still unstaged from the
# agent that didn't get its own commit) with a standardized tag message.
# Args: tag_kind ("Successful ship" | "Successful rewrite" | "Unsuccessful ship")
#       feature_num, summary_oneliner, body_text
loop_commit() {
  local tag_kind="$1" feature_num="$2" summary="$3" body="$4"
  local short_summary; short_summary=$(truncate_to 120 "$summary")
  local subject="[${tag_kind}: Roadmap feature ${feature_num} - ${short_summary}]"
  git add -A >/dev/null 2>&1
  if git diff --cached --quiet; then
    return 0   # nothing to commit
  fi
  git commit -m "$subject" -m "$body" >/dev/null 2>&1 \
    || echo "[$(date -Iseconds)] WARN: loop_commit failed for feature $feature_num" >> "$ALERTS"
  push_if_remote
}

# --- Main loop ---------------------------------------------------------------
total=0
while : ; do
  total=$((total + 1))
  if [ "$total" -gt "$MAX_TOTAL_ITERS" ]; then
    echo "Hit MAX_TOTAL_ITERS=$MAX_TOTAL_ITERS. Stopping."
    break
  fi

  line=$(next_queue_line) || true
  if [ -z "$line" ]; then
    echo "No more pending items in $QUEUE. Exiting."
    break
  fi

  line_no=${line%%:*}
  item_text=${line#*:}
  feature_num=$(extract_feature_num "$item_text")
  slug=$(echo "$item_text" | tr -cd '[:alnum:]' | head -c 32)
  attempt_file="$ATTEMPTS_DIR/$slug"
  attempt=$(cat "$attempt_file" 2>/dev/null || echo 0)
  attempt=$((attempt + 1))
  echo "$attempt" > "$attempt_file"

  if [ "$attempt" -gt "$MAX_ATTEMPTS" ]; then
    sed -i "${line_no}s/- \[ \]/- [!]/" "$QUEUE"
    echo "[$(date -Iseconds)] BLOCKED: $item_text (max attempts)" >> "$ALERTS"
    loop_commit "Unsuccessful ship" "$feature_num" \
      "exhausted $MAX_ATTEMPTS attempts" \
      "Auto-blocked by loop after $MAX_ATTEMPTS failed attempts. See $ALERTS for history. Manual review needed before un-marking [!]."
    rm -f "$attempt_file"
    continue
  fi

  cat > "$HANDOFF" <<EOF
## Current item (from $QUEUE line $line_no)
$item_text

## Attempt
$attempt of $MAX_ATTEMPTS

## Context to load before working
- AGENTS.md         (project brief, harness-first principles, quick start)
- ROADMAP.md        (full plan; the section number in the current item refers here)
- STATE.md          (human-maintained build cursor — READ, do not restructure;
                     you MAY append a short note under "## Agent log" if useful)
- $QUEUE            (the queue you're working from)
- recent tail of $JOURNAL

## Protocol
1. Read the context above plus any acceptance criteria nested under the
   current item in $QUEUE.
2. Implement the item against those acceptance criteria. Run \`npm run build\`
   (and any other checks the criteria name) before concluding.
3. Commit your code changes with a descriptive conventional-commit message.
4. Overwrite $HANDOFF to end with EXACTLY these fields, one per line:
   STATUS: done | partial
   SUMMARY: <1 sentence, will be embedded in the loop's tag commit>
   NEXT_STEPS: <only if partial; concrete handoff for the next agent>
   ACCEPTANCE: <which criteria pass, which don't>
   Do NOT commit $HANDOFF — the loop owns the bookkeeping commit.

## Constraints
- Per-user isolation: do not commit user features/skills to zap or opencode.
- Don't modify zap source — features are user-space Python importing from zap.
- Don't use opencode.ai hosted layer (no Big Pickle / Zen / Go free models).
- No emojis in code or UI unless explicitly requested.
EOF

  echo ">>> [$total] WORK: $item_text (attempt $attempt)"
  pre_sha=$(git rev-parse HEAD)

  timeout "$WORK_TIMEOUT" claude -p \
    --model "$MODEL" \
    --dangerously-skip-permissions \
    "${BUDGET_FLAGS[@]}" \
    "Read $HANDOFF and follow its Protocol exactly." || true

  # Capture work-phase fields BEFORE verify (verify may reset --hard).
  status=$(read_field STATUS)
  summary=$(read_field SUMMARY)
  next_steps=$(read_field NEXT_STEPS)
  acceptance=$(read_field ACCEPTANCE)
  [ -z "$summary" ] && summary="(no summary written by agent)"

  post_work_sha=$(git rev-parse HEAD)

  if [ "$status" != "done" ]; then
    # Partial → keep partial work, commit handoff so next agent can read it.
    echo ">>> partial → will retry on next iteration"
    body=$(printf "Status: partial (attempt %s of %s)\n\nSummary: %s\n\nNext steps: %s\n\nAcceptance: %s\n\nUnderlying commits (kept for next attempt):\n%s" \
      "$attempt" "$MAX_ATTEMPTS" "$summary" "${next_steps:-(none recorded)}" "${acceptance:-(none recorded)}" \
      "$(git log --oneline "${pre_sha}..HEAD" 2>/dev/null || echo '(none)')")
    loop_commit "Unsuccessful ship" "$feature_num" "$summary" "$body"
    echo "[$(date -Iseconds)] PARTIAL: $item_text (attempt $attempt)" >> "$ALERTS"
    sleep "$SLEEP_BETWEEN"
    continue
  fi

  if [ "$pre_sha" = "$post_work_sha" ]; then
    echo ">>> STATUS=done but HEAD unchanged — treating as unsuccessful"
    body=$(printf "Status: claimed done but no commit made (attempt %s).\n\nSummary: %s\n\nAcceptance: %s" \
      "$attempt" "$summary" "${acceptance:-(none recorded)}")
    loop_commit "Unsuccessful ship" "$feature_num" "claimed done but no code committed" "$body"
    echo "[$(date -Iseconds)] WARN: $item_text — STATUS=done, HEAD unchanged" >> "$ALERTS"
    sleep "$SLEEP_BETWEEN"
    continue
  fi

  # --- Verify phase ----------------------------------------------------------
  echo ">>> VERIFY: $item_text (commit $post_work_sha)"
  timeout "$VERIFY_TIMEOUT" claude -p \
    --model "$MODEL" \
    --dangerously-skip-permissions \
    "${BUDGET_FLAGS[@]}" \
    "The previous agent claims the current item in $HANDOFF is done at commit $post_work_sha.
Verify by running its acceptance criteria, \`npm run build\`, and any curl smoke
tests the criteria name. If anything is broken, attempt ONE small fix and re-check.
If still broken, run: git reset --hard ${pre_sha}
Append exactly one line to $HANDOFF: 'VERIFIED: yes' or 'VERIFIED: no' or 'VERIFIED: reverted'.
Do NOT commit $HANDOFF — the loop will." || true

  # Verify may have wiped HANDOFF via reset; re-read fields if possible.
  verified=""
  if [ -f "$HANDOFF" ]; then verified=$(read_field VERIFIED); fi
  post_verify_sha=$(git rev-parse HEAD)

  # Belt-and-suspenders: if verify reports anything other than 'yes' and the
  # work commit is still HEAD, force the rollback ourselves.
  if [ "$verified" != "yes" ] && [ "$post_verify_sha" = "$post_work_sha" ]; then
    echo ">>> verify did not reset; loop forcing 'git reset --hard $pre_sha'"
    git reset --hard "$pre_sha" >/dev/null 2>&1 || true
    verified="${verified:-reverted}"
  fi

  case "$verified" in
    yes)
      sed -i "${line_no}s/- \[ \]/- [x]/" "$QUEUE"
      if [ "$attempt" = "1" ]; then tag="Successful ship"; else tag="Successful rewrite"; fi
      body=$(printf "Status: shipped on attempt %s of %s.\n\nSummary: %s\n\nAcceptance: %s\n\nUnderlying commits:\n%s" \
        "$attempt" "$MAX_ATTEMPTS" "$summary" "${acceptance:-(none recorded)}" \
        "$(git log --oneline "${pre_sha}..HEAD" 2>/dev/null || echo '(none)')")
      loop_commit "$tag" "$feature_num" "$summary" "$body"
      rm -f "$attempt_file"
      echo "[$(date -Iseconds)] DONE: $item_text" >> "$ALERTS"
      ;;
    reverted)
      body=$(printf "Status: code reverted to %s; agent's claim of done did not survive verify.\n\nSummary: %s\n\nNext steps: %s\n\nAcceptance (last reported): %s" \
        "$pre_sha" "$summary" "${next_steps:-(none recorded)}" "${acceptance:-(none recorded)}")
      loop_commit "Unsuccessful ship" "$feature_num" "verify reverted: $summary" "$body"
      echo "[$(date -Iseconds)] REVERTED: $item_text (attempt $attempt)" >> "$ALERTS"
      ;;
    no|*)
      sed -i "${line_no}s/- \[ \]/- [!]/" "$QUEUE"
      body=$(printf "Status: verify inconclusive ('%s'); code reverted to %s.\n\nSummary: %s\n\nNext steps: %s" \
        "$verified" "$pre_sha" "$summary" "${next_steps:-(needs manual review)}")
      loop_commit "Unsuccessful ship" "$feature_num" "verify broken/inconclusive: $summary" "$body"
      echo "[$(date -Iseconds)] BROKEN: $item_text (verify='$verified')" >> "$ALERTS"
      rm -f "$attempt_file"
      ;;
  esac
  sleep "$SLEEP_BETWEEN"
done
