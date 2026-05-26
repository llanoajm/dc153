'use client'

import dynamic from 'next/dynamic'

const CubeMorph = dynamic(() => import('./CubeMorph'), {
  ssr: false,
  loading: () => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/spi-mark-filled.png"
      alt=""
      style={{ width: '100%', display: 'block', mixBlendMode: 'multiply' as const }}
    />
  ),
})

export default function CubeMorphLoader() {
  return <CubeMorph />
}
