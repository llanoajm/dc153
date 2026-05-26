'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  const outerRef = useRef<THREE.Group>(null!)
  const scaled = useRef(false)

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
  })

  useFrame(() => {
    if (outerRef.current) {
      const black = new THREE.MeshBasicMaterial({ color: 0x000000 })
      outerRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = black
      })
    }
  })

  return (
    <group ref={outerRef}>
      <group><primitive object={scene.clone()} /></group>
    </group>
  )
}

function CameraRig() {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(0, 0.05, 2.22)
    camera.lookAt(0, 0, 0)
  }, [camera])
  return null
}

export default function UtilRenderPage() {
  const [model, setModel] = useState('tower')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const m = params.get('model')
    if (m) setModel(m)
  }, [])

  return (
    <div style={{ width: 460, height: 393, background: '#fff' }}>
      <Canvas
        gl={{ antialias: true, preserveDrawingBuffer: true, alpha: false }}
        camera={{ position: [0, 0.05, 2.22], fov: 30 }}
      >
        <color attach="background" args={['#ffffff']} />
        <CameraRig />
        <ambientLight intensity={2} />
        <directionalLight position={[0, 0, 5]} intensity={2} />
        <Suspense fallback={null}>
          <Model url={`/models/${model}.glb`} />
        </Suspense>
      </Canvas>
    </div>
  )
}
