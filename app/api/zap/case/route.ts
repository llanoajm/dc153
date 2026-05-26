import { MODAL_URL, modalHeaders } from '@/lib/zap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const r = await fetch(`${MODAL_URL}/case`, {
    cache: 'no-store',
    headers: modalHeaders(),
  })
  if (!r.ok) return new Response(`Modal /case error ${r.status}`, { status: 502 })
  const data = await r.json()
  return Response.json(data)
}
