// Next.js instrumentation hook. Runs once when the server boots, before any
// request is served. We use it to scrub bearer-token env vars that might have
// been polluted by the shell that launched `npm run dev` (see LOOP_QUEUE.md
// item 10.1).
//
// Edge runtime has no `process.env` access for our secrets, so we only validate
// on the Node.js runtime.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateBearerTokensAtBoot } = await import(
      "./lib/bearer-token-validation"
    )
    validateBearerTokensAtBoot()
  }
}
