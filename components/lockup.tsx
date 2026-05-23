import Image from "next/image"

interface LockupProps {
  size?: "lg" | "md" | "sm"
}

export function Lockup({ size = "lg" }: LockupProps) {
  const markPx = size === "lg" ? 68 : size === "md" ? 44 : 32
  const wordPx = size === "lg" ? 44 : size === "md" ? 26 : 18
  return (
    <div className="flex items-center" style={{ gap: `${markPx * 0.24}px` }}>
      <Image
        src="/spi-mark-filled.png"
        alt="Steinmetz mark"
        width={markPx}
        height={markPx}
        priority
        className="block"
        style={{ height: markPx, width: "auto" }}
      />
      <span className="font-mark" style={{ fontSize: wordPx, lineHeight: 1 }}>
        Steinmetz
      </span>
    </div>
  )
}
