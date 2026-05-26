import { Studio } from './Studio'
import { MODAL_URL, type GridCase } from '@/lib/zap'

async function fetchCase(): Promise<GridCase | null> {
  try {
    const r = await fetch(`${MODAL_URL}/case`, { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as GridCase
  } catch {
    return null
  }
}

export default async function StudioPage() {
  const initialCase = await fetchCase()
  return <Studio initialCase={initialCase} />
}
