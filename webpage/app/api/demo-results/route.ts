import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export async function GET() {
  const resultsPath =
    process.env.DEMO_RESULTS_PATH ??
    path.join(process.cwd(), '..', 'zap', 'data', 'demo', 'results.json')

  try {
    const raw = await readFile(resultsPath, 'utf-8')
    const data = JSON.parse(raw)
    return NextResponse.json({ status: 'ready', data })
  } catch {
    return NextResponse.json({ status: 'pending', data: null })
  }
}
