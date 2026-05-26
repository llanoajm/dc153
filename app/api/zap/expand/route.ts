import { MODAL_URL, modalHeaders } from '@/lib/zap'
import { allowRequest } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  if (!allowRequest(`expand:${ip}`, 6, 60_000)) {
    return new Response('rate_limited', { status: 429 })
  }

  const body = await req.text()

  const upstream = await fetch(`${MODAL_URL}/expand`, {
    method: 'POST',
    headers: modalHeaders({ 'Content-Type': 'application/json' }),
    body,
  })

  if (!upstream.ok || !upstream.body) {
    return new Response(`Modal /expand error ${upstream.status}`, { status: 502 })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
