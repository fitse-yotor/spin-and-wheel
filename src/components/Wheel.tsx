import { useEffect, useRef, type ReactNode } from 'react'
import type { Segment } from '@/lib/realtime'

export interface SectorArc { label: string; start: number; count: number }

/**
 * Roulette-style wheel. The wooden rim is static; the pocket ring and the amber sector ring rotate together
 * (rotation is a CSS transform driven from getAngle() every frame). `children` sit on the fixed hub.
 */
export function Wheel({ segments, sectors = [], getAngle, highlight, children }: { segments: Segment[]; sectors?: SectorArc[]; getAngle: () => number; highlight: number | null; children?: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLCanvasElement>(null)
  const wheelRef = useRef<HTMLCanvasElement>(null)
  const spinRef = useRef<HTMLDivElement>(null)
  const angleFn = useRef(getAngle)
  angleFn.current = getAngle

  useEffect(() => {
    const box = boxRef.current!
    const draw = () => {
      const css = box.clientWidth
      if (!css) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const px = Math.round(css * dpr)
      for (const c of [frameRef.current!, wheelRef.current!]) c.width = c.height = px
      paintFrame(frameRef.current!.getContext('2d')!, px)
      paintWheel(wheelRef.current!.getContext('2d')!, px, segments, sectors, highlight)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(box)
    return () => ro.disconnect()
  }, [segments, sectors, highlight])

  useEffect(() => {
    let raf = 0
    const loop = () => {
      if (spinRef.current) spinRef.current.style.transform = `rotate(${angleFn.current()}deg)`
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={boxRef} className="relative aspect-square h-full max-h-full max-w-full">
      <canvas ref={frameRef} className="absolute inset-0 h-full w-full" />
      <div ref={spinRef} className="absolute inset-0 will-change-transform">
        <canvas ref={wheelRef} className="h-full w-full" />
      </div>
      {/* hub */}
      <div className="absolute left-1/2 top-1/2 flex h-[35%] w-[35%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full" style={{ background: 'radial-gradient(circle at 50% 40%, #a5511f 0%, #6b2d10 45%, #2e1207 100%)', boxShadow: '0 0 0 0.25rem #c99a1d, 0 0 0 0.5rem #4a1d0a, 0 0.6rem 1.6rem rgba(0,0,0,.7)' }}>
        <div className="flex h-[52%] w-[52%] flex-col items-center justify-center rounded-full text-center" style={{ background: 'radial-gradient(circle at 40% 35%, #ffe9a0 0%, #e0a92a 45%, #8a5b08 100%)', boxShadow: 'inset 0 0 0.6rem rgba(0,0,0,.45)', color: '#2a1500' }}>{children}</div>
      </div>
      {/* fixed pointer */}
      <div className="absolute left-1/2 top-[1.2%] z-10 h-[7%] w-[4.2%] -translate-x-1/2 drop-shadow-[0_0.25rem_0.4rem_rgba(0,0,0,0.8)]" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)', background: 'linear-gradient(#ffd867, #e08a00)' }} />
    </div>
  )
}

const TAU = Math.PI * 2
const R_WOOD = 0.99
const R_TRACK = 0.86
const R_OUT = 0.835 // pockets outer edge
const R_IN = 0.585 // pockets inner edge / sector ring outer edge
const R_HUB = 0.36 // sector ring inner edge

function paintFrame(ctx: CanvasRenderingContext2D, size: number) {
  const c = size / 2
  ctx.clearRect(0, 0, size, size)
  const ring = (r0: number, r1: number, fill: string | CanvasGradient) => {
    ctx.beginPath()
    ctx.arc(c, c, c * r1, 0, TAU)
    ctx.arc(c, c, c * r0, 0, TAU, true)
    ctx.fillStyle = fill
    ctx.fill()
  }
  const wood = ctx.createRadialGradient(c, c, c * R_TRACK, c, c, c * R_WOOD)
  wood.addColorStop(0, '#5a1a10')
  wood.addColorStop(0.5, '#8d2a18')
  wood.addColorStop(1, '#3d0f0a')
  ring(R_TRACK, R_WOOD, wood)
  ctx.lineWidth = size * 0.006
  for (const [r, col] of [[R_WOOD, '#d9ad3a'], [R_TRACK, '#d9ad3a'], [R_TRACK - 0.012, '#f4e2a0']] as const) {
    ctx.beginPath()
    ctx.arc(c, c, c * r, 0, TAU)
    ctx.strokeStyle = col
    ctx.stroke()
  }
  // lozenge lamps around the rim
  const n = 48
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU
    const r = c * ((R_WOOD + R_TRACK) / 2)
    ctx.save()
    ctx.translate(c + Math.cos(a) * r, c + Math.sin(a) * r)
    ctx.rotate(a)
    ctx.fillStyle = i % 2 ? '#e7c15a' : '#c7752b'
    ctx.beginPath()
    ctx.moveTo(size * 0.011, 0)
    ctx.lineTo(0, size * 0.005)
    ctx.lineTo(-size * 0.011, 0)
    ctx.lineTo(0, -size * 0.005)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  ctx.beginPath()
  ctx.arc(c, c, c * R_TRACK, 0, TAU)
  ctx.fillStyle = '#1a0b06'
  ctx.fill()
}

function paintWheel(ctx: CanvasRenderingContext2D, size: number, segs: Segment[], sectors: SectorArc[], highlight: number | null) {
  const c = size / 2
  const n = segs.length
  const step = TAU / n
  const top = -Math.PI / 2
  ctx.clearRect(0, 0, size, size)

  // pockets
  segs.forEach((s, i) => {
    const a0 = top + i * step
    ctx.globalAlpha = highlight !== null && highlight !== i ? 0.3 : 1
    ctx.beginPath()
    ctx.arc(c, c, c * R_OUT, a0, a0 + step)
    ctx.arc(c, c, c * R_IN, a0 + step, a0, true)
    ctx.closePath()
    ctx.fillStyle = s.color
    ctx.fill()
    ctx.lineWidth = size * 0.0032
    ctx.strokeStyle = '#d9ad3a'
    ctx.stroke()
    ctx.save()
    ctx.translate(c, c)
    ctx.rotate(a0 + step / 2)
    ctx.translate(c * (R_OUT - 0.085), 0)
    ctx.rotate(Math.PI / 2)
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${size * (n > 45 ? 0.028 : 0.04)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(s.name, 0, 0)
    ctx.restore()
    ctx.globalAlpha = 1
  })
  if (highlight !== null) {
    const a0 = top + highlight * step
    ctx.beginPath()
    ctx.arc(c, c, c * R_OUT, a0, a0 + step)
    ctx.arc(c, c, c * R_IN, a0 + step, a0, true)
    ctx.closePath()
    ctx.lineWidth = size * 0.009
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
  }

  // sector ring
  const ringFill = ctx.createRadialGradient(c, c, c * R_HUB, c, c, c * R_IN)
  ringFill.addColorStop(0, '#f2b21f')
  ringFill.addColorStop(1, '#dc9410')
  ctx.beginPath()
  ctx.arc(c, c, c * R_IN, 0, TAU)
  ctx.arc(c, c, c * R_HUB, 0, TAU, true)
  ctx.fillStyle = ringFill
  ctx.fill()
  ctx.lineWidth = size * 0.004
  ctx.strokeStyle = '#8a5a00'
  ctx.stroke()
  for (const s of sectors) {
    const a0 = top + s.start * step
    const a1 = a0 + s.count * step
    for (const a of [a0, a1]) {
      ctx.beginPath()
      ctx.moveTo(c + Math.cos(a) * c * R_HUB, c + Math.sin(a) * c * R_HUB)
      ctx.lineTo(c + Math.cos(a) * c * R_IN, c + Math.sin(a) * c * R_IN)
      ctx.lineWidth = size * 0.005
      ctx.strokeStyle = '#8a5a00'
      ctx.stroke()
    }
    const mid = (a0 + a1) / 2
    ctx.save()
    ctx.translate(c, c)
    ctx.rotate(mid)
    ctx.translate(c * ((R_IN + R_HUB) / 2), 0)
    ctx.rotate(Math.PI / 2)
    ctx.fillStyle = '#7a4a00'
    ctx.font = `800 ${size * 0.05}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(s.label, 0, 0)
    ctx.restore()
  }
}
