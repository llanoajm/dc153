'use client'

import { useRef, useEffect, useCallback, useMemo, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
// @ts-expect-error flubber has no types
import { interpolate } from 'flubber'
import * as THREE from 'three'
import styles from '../page.module.css'

const CUBE = [
  'M 113.5,78.6 C 61.2,114.5 17.0,145.1 15.3,146.5 C 13.4,148.0 12.0,150.0 12.0,151.2 C 12.0,152.7 98.1,293.7 121.5,330.5 C 122.2,331.6 142.6,343.4 166.8,356.8 C 208.8,380.0 211.0,381.1 213.5,379.8 C 217.2,378.0 442.0,226.1 444.8,223.7 C 446.0,222.6 447.0,220.5 447.0,219.1 C 447.0,217.3 427.9,187.5 389.1,128.5 L 331.2,40.5 L 273.4,26.8 C 241.5,19.3 213.9,13.1 212.0,13.1 C 209.0,13.2 194.0,23.2 113.5,78.6 Z',
  'M 334.9,69.7 C 339.8,77.3 343.8,83.5 343.7,83.6 C 343.6,83.7 329.1,93.1 311.5,104.5 C 293.9,115.9 272.1,130.2 263.0,136.1 C 253.9,142.0 225.6,160.5 200.0,177.2 C 158.1,204.5 153.5,207.8 153.2,210.4 C 152.9,212.7 156.0,218.1 169.4,238.2 C 179.7,253.5 187.0,263.5 188.5,264.2 C 190.4,265.0 191.5,264.9 194.0,263.4 C 195.7,262.3 222.0,244.8 252.5,224.3 L 307.9,187.1 L 333.6,225.2 C 347.7,246.1 359.3,263.9 359.4,264.6 C 359.5,266.3 214.1,364.5 213.0,363.4 C 211.8,362.1 202.0,345.0 202.0,344.1 C 202.0,343.7 230.4,324.4 265.0,301.1 C 317.0,266.3 328.0,258.5 327.9,256.7 C 327.9,255.5 322.9,247.1 316.7,238.0 C 307.7,224.7 305.0,221.4 303.0,221.2 C 301.0,221.0 285.7,230.8 238.5,262.4 L 176.6,304.0 L 172.7,297.7 C 170.5,294.3 167.6,289.6 166.1,287.2 C 162.6,281.6 155.7,270.7 147.8,258.5 C 136.5,241.0 112.0,201.1 112.1,200.3 C 112.1,199.4 324.0,56.0 325.2,56.0 C 325.6,56.0 330.0,62.2 334.9,69.7 Z',
  'M 73.9,190.0 L 98.3,203.5 L 145.1,279.0 C 170.8,320.5 191.7,354.6 191.5,354.8 C 191.4,354.9 177.9,347.7 161.5,338.6 L 131.7,322.1 L 84.8,246.4 C 59.1,204.8 38.0,170.6 38.0,170.4 C 38.0,170.2 40.6,171.4 43.7,173.2 C 46.9,175.0 60.5,182.5 73.9,190.0 Z',
  'M 386.3,189.0 C 391.1,196.1 395.0,202.3 395.0,202.7 C 395.0,203.5 369.7,220.5 368.6,220.5 C 368.3,220.5 364.0,214.4 359.0,207.1 L 350.1,193.6 L 363.3,184.8 C 370.6,180.0 376.8,176.0 377.1,176.0 C 377.4,176.0 381.6,181.8 386.3,189.0 Z',
]

const TOWER = [
  'M 187.0,73.7 C 179.0,73.9 171.8,74.3 171.0,74.6 C 168.9,75.4 171.3,76.3 193.5,82.2 C 203.9,84.9 213.1,87.5 213.8,87.9 C 214.4,88.3 209.9,90.0 203.8,91.8 C 197.6,93.6 187.3,96.7 181.0,98.7 C 171.6,101.7 170.0,102.5 172.0,103.1 C 173.4,103.5 185.0,103.8 197.8,103.9 L 221.1,104.0 L 220.8,117.2 L 220.5,130.4 L 196.0,137.8 C 182.5,141.8 171.1,145.6 170.5,146.1 C 170.0,146.6 179.6,147.0 195.3,147.0 L 221.0,147.0 L 221.0,160.3 L 221.0,173.7 L 196.3,180.9 C 182.6,184.9 171.1,188.6 170.6,189.1 C 170.0,189.6 179.9,190.0 195.4,190.0 L 221.1,190.0 L 220.5,195.2 C 219.4,204.9 204.1,392.4 204.4,392.7 C 204.6,392.9 216.1,392.9 230.1,392.8 L 255.6,392.5 L 247.9,299.5 C 243.7,248.3 239.9,202.8 239.5,198.2 L 238.7,190.0 L 264.6,190.0 C 280.0,190.0 290.0,189.6 289.5,189.1 C 288.6,188.3 256.9,178.7 243.3,175.1 L 239.0,173.9 L 239.0,160.5 L 239.0,147.0 L 264.6,147.0 C 278.6,147.0 289.9,146.6 289.6,146.1 C 289.3,145.7 277.8,142.0 264.0,137.9 L 239.0,130.5 L 239.0,117.2 L 239.0,104.0 L 262.3,103.9 C 275.0,103.8 286.6,103.5 287.9,103.1 C 290.2,102.5 278.5,98.4 251.0,90.2 C 247.2,89.1 245.1,88.0 246.0,87.7 C 246.8,87.4 255.2,85.1 264.5,82.5 C 287.6,76.3 290.5,75.4 289.3,74.7 C 288.1,73.9 208.0,73.1 187.0,73.7 Z',
  'M 235.0,252.2 C 237.5,255.5 239.9,258.8 240.4,259.5 C 241.1,260.4 239.7,263.0 235.6,268.5 L 229.9,276.1 L 224.0,268.4 L 218.1,260.7 L 221.0,257.1 C 222.7,255.1 225.3,251.8 226.8,249.8 C 228.3,247.7 229.7,246.1 230.0,246.1 C 230.3,246.1 232.5,248.8 235.0,252.2 Z',
  'M 236.7,289.8 L 242.7,296.5 L 236.4,303.5 L 230.1,310.4 L 227.4,308.0 C 226.0,306.6 223.0,303.3 220.7,300.7 L 216.7,295.9 L 223.1,289.4 C 226.6,285.9 229.7,283.0 230.0,283.0 C 230.3,283.0 233.3,286.0 236.7,289.8 Z',
  'M 236.8,361.8 C 242.0,366.2 243.4,367.9 242.4,368.6 C 241.7,369.1 238.6,371.5 235.6,373.9 L 230.0,378.2 L 222.9,372.9 L 215.9,367.5 L 219.7,364.5 C 221.8,362.9 224.8,360.3 226.5,358.8 C 228.1,357.3 229.6,356.0 229.7,356.0 C 229.7,356.0 233.0,358.6 236.8,361.8 Z',
]

const BATTERY = [
  'M 214.8,117.7 C 213.7,118.0 213.0,119.1 213.0,120.4 C 213.0,121.7 212.7,124.2 212.4,125.9 L 211.8,129.0 L 201.9,129.0 C 193.4,129.0 168.6,132.9 165.8,134.7 C 165.3,134.9 165.0,193.1 165.0,264.1 L 165.0,393.0 L 231.5,393.0 L 298.0,393.0 L 297.8,263.7 L 297.5,134.5 L 287.5,132.2 C 281.1,130.7 272.8,129.7 264.3,129.3 C 249.8,128.7 250.0,128.8 250.0,121.4 C 250.0,119.0 249.5,118.1 247.8,117.6 C 245.2,116.9 217.4,117.0 214.8,117.7 Z',
  'M 230,196 L 230.1,196 L 230.1,196.1 Z',
  'M 230,196 L 230.1,196 L 230.1,196.1 Z',
  'M 230,196 L 230.1,196 L 230.1,196.1 Z',
]

const SOLAR = [
  'M 86.5,108.2 C 86.3,108.9 76.0,137.6 63.6,172.0 L 41.2,234.5 L 42.2,240.0 C 42.8,243.0 43.8,245.9 44.5,246.5 C 45.3,247.2 45.8,255.3 46.3,275.2 L 46.8,302.8 L 44.4,305.1 C 41.4,307.9 41.4,311.1 44.1,318.2 C 47.8,327.9 47.9,327.9 55.4,322.5 C 62.8,317.3 62.7,317.5 60.9,305.7 C 60.2,301.3 59.1,297.9 58.0,297.0 C 56.5,295.6 56.2,292.5 55.8,271.2 L 55.2,247.0 L 70.6,247.0 L 86.0,247.0 L 86.0,258.0 L 86.0,268.9 L 83.0,270.5 C 78.1,273.0 79.6,276.7 86.4,279.0 C 89.3,279.9 90.9,279.8 95.5,278.4 C 98.9,277.3 101.0,276.1 101.0,275.2 C 101.0,273.0 96.2,267.0 94.4,267.0 C 93.3,267.0 93.0,265.1 93.0,257.2 L 93.0,247.3 L 105.2,246.7 C 111.8,246.3 141.9,246.0 172.0,246.0 L 226.7,246.0 L 227.4,242.2 C 227.7,240.2 228.0,236.1 228.0,233.2 C 228.0,228.7 228.3,228.0 230.0,228.0 C 231.7,228.0 232.0,228.7 232.0,233.2 C 232.0,236.1 232.3,240.2 232.6,242.2 L 233.3,246.0 L 288.0,246.0 C 318.1,246.0 348.2,246.3 354.8,246.7 L 367.0,247.3 L 367.0,257.2 C 367.0,265.1 366.7,267.0 365.6,267.0 C 363.9,267.0 359.0,273.0 359.0,275.1 C 359.0,276.0 361.2,277.3 364.4,278.4 C 369.8,280.3 370.0,280.3 374.7,278.3 C 378.6,276.7 379.5,275.9 379.5,273.9 C 379.5,272.3 378.6,271.1 376.8,270.2 L 374.0,268.9 L 374.0,257.9 L 374.0,247.0 L 389.4,247.0 L 404.8,247.0 L 404.2,271.2 C 403.8,292.8 403.5,295.6 401.9,297.0 C 400.8,297.9 399.8,301.1 399.1,305.7 C 397.3,317.6 397.2,317.4 404.5,322.6 C 410.8,327.0 411.2,327.2 412.5,325.4 C 414.7,322.6 418.0,313.3 418.0,310.1 C 418.0,308.5 417.0,306.4 415.6,305.1 L 413.2,302.8 L 413.7,275.2 C 414.2,254.4 414.6,247.3 415.6,246.5 C 416.3,245.9 417.3,243.0 417.8,240.0 L 418.8,234.6 L 396.5,172.5 C 384.2,138.4 373.8,109.7 373.5,108.7 C 372.8,107.1 368.5,107.0 302.4,107.0 L 232.0,107.0 L 232.0,161.5 C 232.0,215.3 232.0,216.0 230.0,216.0 C 228.0,216.0 228.0,215.3 228.0,161.5 L 228.0,107.0 L 157.5,107.0 C 101.9,107.0 86.8,107.3 86.5,108.2 Z',
  'M 230,196 L 230.1,196 L 230.1,196.1 Z',
  'M 230,196 L 230.1,196 L 230.1,196.1 Z',
  'M 230,196 L 230.1,196 L 230.1,196.1 Z',
]

const ALL_SHAPES = [CUBE, SOLAR]
const N_PATHS = 4
const N_SHAPES = ALL_SHAPES.length

const MODEL_URLS = [
  null,
  '/models/solar.glb',
]

const T_MORPH = 1.5
const T_HOLD = 3.0
const T_SPIN = 4.0
const T_SVG_PHASE = T_MORPH + T_HOLD
const T_3D_PHASE = T_MORPH + T_SPIN + 0.4

function phaseDur(s: number) {
  return s === 0 ? T_SVG_PHASE : T_3D_PHASE
}

let TOTAL = 0
const PHASE_STARTS: number[] = []
for (let s = 0; s < N_SHAPES; s++) {
  PHASE_STARTS.push(TOTAL)
  TOTAL += phaseDur(s)
}

function ease(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

type Interp = (t: number) => string

const animState = { activeModelIdx: -1, spinProgress: 0 }

const BLUE = '#0000BB'

const dotShader = {
  uniforms: { uColor: { value: new THREE.Color(BLUE) } },
  vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 uColor;
    void main() {
      vec2 p = mod(gl_FragCoord.xy, 5.0);
      float d = length(p - 2.5);
      if (d > 1.0) discard;
      gl_FragColor = vec4(uColor, 0.65);
    }
  `,
}

function GLBModel({ url, idx }: { url: string; idx: number }) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(() => scene.clone(), [scene])
  const outerRef = useRef<THREE.Group>(null!)
  const scaled = useRef(false)
  const styled = useRef(false)

  useEffect(() => {
    if (!scaled.current && outerRef.current) {
      outerRef.current.updateWorldMatrix(true, true)
      const centroid = new THREE.Vector3()
      let vertCount = 0
      outerRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const geo = (child as THREE.Mesh).geometry
          const pos = geo.attributes.position
          const wm = child.matrixWorld
          const v = new THREE.Vector3()
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(wm)
            centroid.add(v)
            vertCount++
          }
        }
      })
      if (vertCount > 0) centroid.divideScalar(vertCount)
      const box = new THREE.Box3().setFromObject(outerRef.current)
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      if (maxDim > 0) {
        const s = 1.0 / maxDim
        outerRef.current.scale.setScalar(s)
        outerRef.current.position.set(-centroid.x * s, -centroid.y * s, -centroid.z * s)
        scaled.current = true
      }
    }

    if (!styled.current && outerRef.current) {
      const meshes: THREE.Mesh[] = []
      outerRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh)
      })

      const fillMat = new THREE.ShaderMaterial({
        ...dotShader,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const lineMat = new THREE.LineBasicMaterial({ color: BLUE })

      for (const mesh of meshes) {
        mesh.material = fillMat
        const edges = new THREE.EdgesGeometry(mesh.geometry, 25)
        const lines = new THREE.LineSegments(edges, lineMat)
        mesh.add(lines)
      }
      styled.current = true
    }
  })

  useFrame(() => {
    if (!outerRef.current) return
    const active = animState.activeModelIdx === idx
    outerRef.current.visible = active
    if (active) {
      outerRef.current.rotation.y = animState.spinProgress * Math.PI * 4
    }
  })

  return (
    <group ref={outerRef}>
      <group>
        <primitive object={cloned} />
      </group>
    </group>
  )
}

function CameraRig() {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(0.18, -0.04, 2.22)
    camera.lookAt(0, 0, 0)
  }, [camera])
  return null
}

export default function HeroAnimation() {
  const pathRefs = useRef<(SVGPathElement | null)[]>([])
  const canvasRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const morphsRef = useRef<Interp[][]>([])

  const setPathRef = useCallback((i: number) => (el: SVGPathElement | null) => {
    pathRefs.current[i] = el
  }, [])

  useEffect(() => {
    const m: Interp[][] = []
    for (let s = 0; s < N_SHAPES; s++) {
      const nx = (s + 1) % N_SHAPES
      m.push(ALL_SHAPES[s].map((_, p) =>
        interpolate(ALL_SHAPES[s][p], ALL_SHAPES[nx][p], { maxSegmentLength: 8 })
      ))
    }
    morphsRef.current = m
  }, [])

  const animate = useCallback(() => {
    const t0 = performance.now()

    const tick = (now: number) => {
      const t = ((now - t0) / 1000) % TOTAL
      const paths = pathRefs.current
      const cvs = canvasRef.current
      if (!cvs || paths.some(p => !p)) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      let shapeIdx = 0
      for (let s = N_SHAPES - 1; s >= 0; s--) {
        if (t >= PHASE_STARTS[s]) { shapeIdx = s; break }
      }
      const local = t - PHASE_STARTS[shapeIdx]
      const prevIdx = (shapeIdx - 1 + N_SHAPES) % N_SHAPES
      const isModel = shapeIdx > 0

      // Split the morph into path-shape and dot-fill stages so the SVG resembles
      // the dotted 3D before the hand-off (forward), and simplifies first on the
      // way back (reverse). No simultaneous render — clean cuts.
      const PATH_END = 0.7    // forward: path morph finishes at 70% of T_MORPH
      const FILL_END = 0.3    // reverse: dot fill fades out by 30% of T_MORPH

      if (isModel) {
        // Cube → 3D phase
        if (local < T_MORPH) {
          const morphP = local / T_MORPH
          if (morphP < PATH_END) {
            // Stage A: morph paths only, no dots
            const p = ease(morphP / PATH_END)
            for (let i = 0; i < N_PATHS; i++) {
              const el = paths[i]!
              el.setAttribute('d', morphsRef.current[prevIdx][i](p))
              el.style.opacity = '1'
              el.setAttribute('fill-opacity', '0')
            }
          } else {
            // Stage B: paths at final shape, fade dots in
            const fillP = ease((morphP - PATH_END) / (1 - PATH_END))
            for (let i = 0; i < N_PATHS; i++) {
              const el = paths[i]!
              el.setAttribute('d', morphsRef.current[prevIdx][i](1))
              el.style.opacity = '1'
              el.setAttribute('fill-opacity', String(fillP))
            }
          }
          cvs.style.clipPath = 'circle(0% at 50% 50%)'
          animState.activeModelIdx = -1
          animState.spinProgress = 0
        } else {
          // 3D spin
          for (let i = 0; i < N_PATHS; i++) {
            paths[i]!.style.opacity = '0'
            paths[i]!.setAttribute('fill-opacity', '0')
          }
          cvs.style.clipPath = 'circle(100% at 50% 50%)'
          animState.activeModelIdx = shapeIdx
          animState.spinProgress = Math.min(1, (local - T_MORPH) / T_SPIN)
        }
      } else {
        // 3D → Cube phase
        if (local < T_MORPH) {
          const morphP = local / T_MORPH
          if (morphP < FILL_END) {
            // Stage A: SVG shows the model's silhouette with dots, fade dots out
            const fillP = 1 - ease(morphP / FILL_END)
            for (let i = 0; i < N_PATHS; i++) {
              const el = paths[i]!
              el.setAttribute('d', morphsRef.current[prevIdx][i](0))
              el.style.opacity = '1'
              el.setAttribute('fill-opacity', String(fillP))
            }
          } else {
            // Stage B: morph paths back to cube, no dots
            const p = ease((morphP - FILL_END) / (1 - FILL_END))
            for (let i = 0; i < N_PATHS; i++) {
              const el = paths[i]!
              el.setAttribute('d', morphsRef.current[prevIdx][i](p))
              el.style.opacity = '1'
              el.setAttribute('fill-opacity', '0')
            }
          }
          cvs.style.clipPath = 'circle(0% at 50% 50%)'
          animState.activeModelIdx = -1
          animState.spinProgress = 0
        } else {
          // Hold cube
          for (let i = 0; i < N_PATHS; i++) {
            const el = paths[i]!
            el.setAttribute('d', CUBE[i])
            el.style.opacity = '1'
            el.setAttribute('fill-opacity', '0')
          }
          cvs.style.clipPath = 'circle(0% at 50% 50%)'
          animState.activeModelIdx = -1
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    animate()
    return () => cancelAnimationFrame(rafRef.current)
  }, [animate])

  return (
    <div className={styles.cubeWrap}>
      <div ref={canvasRef} className={styles.canvasLayer}>
        <Canvas gl={{ antialias: true, alpha: true }} camera={{ position: [0, 0.05, 2.22], fov: 30 }}>
          <CameraRig />
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 5, 5]} intensity={1.5} />
          <directionalLight position={[-3, 2, 3]} intensity={0.5} color="#ffffff" />
          <Suspense fallback={null}>
            {MODEL_URLS.map((url, idx) =>
              url ? <GLBModel key={url} url={url} idx={idx} /> : null
            )}
          </Suspense>
        </Canvas>
      </div>

      <svg className={styles.cubeSvg} viewBox="0 0 460 393" fill="none">
        <defs>
          <pattern id="cubeDotFill" x="0" y="0" width="5" height="5" patternUnits="userSpaceOnUse">
            <circle cx="2.5" cy="2.5" r="1.2" fill="#0000BB" fillOpacity="0.9" />
          </pattern>
        </defs>
        {CUBE.map((d, i) => (
          <path
            key={i}
            ref={setPathRef(i)}
            d={d}
            stroke="#0000BB"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="url(#cubeDotFill)"
            fillOpacity={0}
          />
        ))}
      </svg>
    </div>
  )
}
