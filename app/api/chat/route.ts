import { openai } from '@ai-sdk/openai'
import { streamText, convertToModelMessages, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { allowRequest } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM = `You are the Steinmetz grid co-pilot. The user is studying a real LATAM grid (12 buses across Chile + Argentina, 24-hour horizon) and you can drive a differentiable expansion optimizer (zap on H100) on their behalf.

The loss function is composed of weighted primitives:
  - dispatch_cost: operational $ cost. Increase weight to push toward cheaper dispatch.
  - emissions: total CO₂ (g). Increase weight to discourage fossil generation.
  - inv_burden: L1 penalty on new capacity built beyond baseline. Increase weight to discourage overbuilding (e.g. when the user wants "minimal new construction" or "tight budget").
  - peak_line_loading: smoothed max of line utilization. Increase weight to relieve congestion / improve N-1-ish resilience.
The investment cost (annualized $ of capital) is always added; users dial only the operation-side weights.

You have these tools:
- define_loss(terms): set the active loss composition. Each term is {name, weight}. Use when the user asks "what should the metric be?" or describes a planning intent qualitatively without immediately running. Tells the user what you set without launching the solver.
- run_expansion(loss_spec, steps): kicks off the gradient-descent expansion loop with a given loss_spec (or empty to reuse the current one). Use ~30 steps for short demos, up to 60 for longer. The loop streams live capacities to the user's screen.
- describe_grid(): summarize the currently loaded grid topology.
- explain_result(): comment on the latest solver run (capacities, loss curve).

Rules:
- When the user expresses a planning intent ("minimize emissions", "make it cheaper", "expand cheaply", "relieve congestion"), pick a sensible loss_spec and call run_expansion. Then briefly tell them what you launched in 1-2 sentences.
- For nuanced intents like "minimize emissions but don't overbuild" — combine emissions + inv_burden. For "no new lines, just dispatch better" — use only dispatch_cost.
- Default weights to start: dispatch_cost=1.0, emissions=1.0, inv_burden=100, peak_line_loading=10000 (the primitives have very different magnitudes — these are calibrated).
- When the user asks what's on the screen, call describe_grid.
- When the user asks how the run went, call explain_result.
- Keep responses short. Never invent numbers — defer to tool output.`

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  if (!allowRequest(`chat:${ip}`, 20, 60_000)) {
    return new Response('rate_limited', { status: 429 })
  }
  const { messages } = await req.json()

  const result = streamText({
    model: openai('gpt-5.1'),
    system: SYSTEM,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    tools: {
      define_loss: tool({
        description:
          'Set the active loss composition without launching the solver. Use when the user describes intent and you want to confirm the metric before running.',
        inputSchema: z.object({
          terms: z.array(z.object({
            name: z.enum(['dispatch_cost', 'emissions', 'inv_burden', 'peak_line_loading']),
            weight: z.number().min(0),
          })).min(1),
        }),
      }),
      run_expansion: tool({
        description:
          'Run the differentiable expansion optimizer with the given loss_spec (or omit to reuse current). Streams live capacities to the canvas.',
        inputSchema: z.object({
          loss_spec: z.object({
            terms: z.array(z.object({
              name: z.enum(['dispatch_cost', 'emissions', 'inv_burden', 'peak_line_loading']),
              weight: z.number().min(0),
            })).min(1),
          }).optional(),
          steps: z.number().int().min(5).max(80).default(30),
        }),
      }),
      describe_grid: tool({
        description: 'Describe the currently loaded grid topology.',
        inputSchema: z.object({}),
      }),
      explain_result: tool({
        description:
          'Briefly explain the latest solver run — what changed in capacities and why.',
        inputSchema: z.object({}),
      }),
    },
  })

  return result.toUIMessageStreamResponse()
}
