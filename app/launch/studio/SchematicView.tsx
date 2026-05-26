'use client'

import { useMemo } from 'react'
import ReactFlow, { Background, Controls, Edge, Node } from 'reactflow'
import dagre from 'dagre'
import 'reactflow/dist/style.css'
import type { GridCase } from '@/lib/zap'

const NODE_BG: Record<string, string> = {
  generator: '#f0891e',
  datacenter: '#785fdc',
  junction: '#888',
}

function layout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 90 })
  g.setDefaultEdgeLabel(() => ({}))
  nodes.forEach(n => g.setNode(n.id, { width: 110, height: 60 }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map(n => {
    const p = g.node(n.id)
    return { ...n, position: { x: p.x - 55, y: p.y - 30 } }
  })
}

export function SchematicView({
  grid, liveGen, liveLine,
}: { grid: GridCase; liveGen: number[]; liveLine: number[] }) {
  const { nodes, edges } = useMemo(() => {
    const genByBus: Record<number, { name: string; mw: number }> = {}
    grid.generators.forEach((g, i) => {
      const mw = liveGen[i] ?? g.capacity_mw
      const cur = genByBus[g.bus]
      genByBus[g.bus] = cur
        ? { name: `${cur.name}+${g.name}`, mw: cur.mw + mw }
        : { name: g.name, mw }
    })

    const rawNodes: Node[] = grid.buses.map(b => {
      const info = genByBus[b.id]
      const label =
        b.type === 'datacenter'
          ? `DC · ${b.name}`
          : info
            ? `${info.name}\n${info.mw.toFixed(0)} MW`
            : b.name
      return {
        id: String(b.id),
        data: { label },
        position: { x: 0, y: 0 },
        style: {
          background: NODE_BG[b.type] ?? '#666',
          color: '#fff',
          borderRadius: 8,
          padding: 8,
          width: 110,
          fontSize: 11,
          fontWeight: 600,
          whiteSpace: 'pre-line',
          textAlign: 'center',
          border: 'none',
        },
      }
    })

    const maxLine = Math.max(50, ...liveLine)
    const rawEdges: Edge[] = grid.branches.map((b, i) => {
      const cap = liveLine[i] ?? b.capacity_mw
      return {
        id: b.id,
        source: String(b.src),
        target: String(b.dst),
        label: `${cap.toFixed(0)} MW`,
        animated: !b.fixed,
        style: {
          stroke: b.fixed ? '#785fdc' : '#1a1a1a',
          strokeWidth: 1 + (cap / maxLine) * 4,
        },
        labelStyle: { fontSize: 10, fontWeight: 600, fill: '#333' },
        labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
      }
    })

    return { nodes: layout(rawNodes, rawEdges), edges: rawEdges }
  }, [grid, liveGen, liveLine])

  return (
    <div className="schematic-wrap">
      <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.4} maxZoom={2}>
        <Background gap={20} size={1} color="#e0e0e0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
