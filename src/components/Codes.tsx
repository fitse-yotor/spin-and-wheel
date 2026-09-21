import qrcode from 'qrcode-generator'
import { useMemo } from 'react'
import { code128 } from '@/lib/barcode'

export function Barcode({ value, height = 44 }: { value: string; height?: number }) {
  const runs = useMemo(() => code128(value), [value])
  const quiet = 10
  const total = runs.reduce((a, b) => a + b, 0) + quiet * 2
  let x = quiet
  const bars: { x: number; w: number }[] = []
  runs.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w })
    x += w
  })
  return (
    <svg viewBox={`0 0 ${total} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} role="img" aria-label={`Barcode ${value}`}>
      <rect width={total} height={height} fill="#fff" />
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />
      ))}
    </svg>
  )
}

export function QR({ value, size = 120 }: { value: string; size?: number }) {
  const { count, dark } = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(value)
    q.make()
    const n = q.getModuleCount()
    const cells: string[] = []
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) cells.push(`M${c + 2} ${r + 2}h1v1h-1z`)
    return { count: n, dark: cells.join('') }
  }, [value])
  return (
    <svg viewBox={`0 0 ${count + 4} ${count + 4}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label="Ticket QR code">
      <rect width={count + 4} height={count + 4} fill="#fff" />
      <path d={dark} fill="#000" />
    </svg>
  )
}
