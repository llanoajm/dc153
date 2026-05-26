'use client'

import { useEffect, useMemo, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { Deck } from '@deck.gl/core'
import { ScatterplotLayer, LineLayer, TextLayer } from '@deck.gl/layers'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GridCase } from '@/lib/zap'
import type { SolveState } from './Studio'

const NODE_COLOR: Record<string, [number, number, number]> = {
  generator: [240, 137, 30],
  datacenter: [120, 95, 220],
  junction: [120, 120, 120],
}

export function MapView({
  grid, liveGen, liveLine, solve,
}: { grid: GridCase; liveGen: number[]; liveLine: number[]; solve: SolveState }) {
  const mapDiv = useRef<HTMLDivElement>(null)
  const deckCanvas = useRef<HTMLCanvasElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const deckRef = useRef<Deck | null>(null)

  const initialViewState = useMemo(() => {
    const lats = grid.buses.map(b => b.lat)
    const lngs = grid.buses.map(b => b.lng)
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2
    const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2
    return { latitude: lat, longitude: lng, zoom: 4, pitch: 0, bearing: 0 }
  }, [grid])

  useEffect(() => {
    if (!mapDiv.current || !deckCanvas.current) return

    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap, © CARTO',
          },
        },
        layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
      },
      center: [initialViewState.longitude, initialViewState.latitude],
      zoom: initialViewState.zoom,
      interactive: true,
    })
    mapRef.current = map

    const deck = new Deck({
      canvas: deckCanvas.current,
      width: '100%',
      height: '100%',
      initialViewState,
      controller: false,
      onViewStateChange: ({ viewState }) => {
        map.jumpTo({
          center: [viewState.longitude, viewState.latitude],
          zoom: viewState.zoom,
          bearing: viewState.bearing,
          pitch: viewState.pitch,
        })
      },
      layers: [],
    })
    deckRef.current = deck

    const sync = () => {
      const { lng, lat } = map.getCenter()
      deck.setProps({
        viewState: {
          longitude: lng,
          latitude: lat,
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        },
      })
    }
    map.on('move', sync)

    return () => {
      map.off('move', sync)
      deck.finalize()
      map.remove()
    }
  }, [initialViewState])

  useEffect(() => {
    const deck = deckRef.current
    if (!deck) return

    const busById = Object.fromEntries(grid.buses.map(b => [b.id, b]))
    const maxLine = Math.max(50, ...liveLine)
    const maxGen = Math.max(50, ...liveGen, ...grid.generators.map(g => g.capacity_mw))

    const lineLayer = new LineLayer({
      id: 'branches',
      data: grid.branches.map((b, i) => ({
        ...b,
        cap: liveLine[i] ?? b.capacity_mw,
        from: [busById[b.src].lng, busById[b.src].lat],
        to: [busById[b.dst].lng, busById[b.dst].lat],
      })),
      getSourcePosition: (d: any) => d.from,
      getTargetPosition: (d: any) => d.to,
      getColor: (d: any) => d.fixed ? [120, 95, 220, 220] : [40, 40, 40, 200],
      getWidth: (d: any) => 1.5 + (d.cap / maxLine) * 6,
      widthUnits: 'pixels',
    })

    const genCapForBus: Record<number, number> = {}
    grid.generators.forEach((g, i) => {
      genCapForBus[g.bus] = (genCapForBus[g.bus] ?? 0) + (liveGen[i] ?? g.capacity_mw)
    })

    const nodeLayer = new ScatterplotLayer({
      id: 'buses',
      data: grid.buses,
      getPosition: (b: any) => [b.lng, b.lat],
      getRadius: (b: any) => {
        if (b.type === 'datacenter') return 14
        const c = genCapForBus[b.id]
        return c ? 8 + Math.min(16, (c / maxGen) * 16) : 7
      },
      radiusUnits: 'pixels',
      getFillColor: (b: any) => {
        const c = NODE_COLOR[b.type] ?? [80, 80, 80]
        return [...c, 220] as [number, number, number, number]
      },
      stroked: true,
      getLineColor: [255, 255, 255, 255],
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
    })

    const labelLayer = new TextLayer({
      id: 'labels',
      data: grid.buses,
      getPosition: (b: any) => [b.lng, b.lat],
      getText: (b: any) => {
        if (b.type === 'datacenter') return 'DC'
        const c = genCapForBus[b.id]
        return c ? `${c.toFixed(0)} MW` : b.name
      },
      getSize: 11,
      getColor: [20, 20, 20, 230],
      getPixelOffset: [0, -20],
      fontWeight: 600,
    })

    deck.setProps({ layers: [lineLayer, nodeLayer, labelLayer] })
  }, [grid, liveGen, liveLine])

  return (
    <div className="map-wrap">
      <div ref={mapDiv} className="map-base" />
      <canvas ref={deckCanvas} className="deck-canvas" />
      {solve.running && (
        <div className="map-overlay">
          iter {solve.iter}/{solve.steps} · loss {solve.loss.toFixed(0)} · {solve.device}
        </div>
      )}
    </div>
  )
}
