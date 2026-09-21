import { useId } from 'react'

/**
 * Original greyhound artwork, drawn as SVG (side view, facing right). The legs gallop while `running`.
 * `coat` is the dog's colour; `jacket` and `trap` are the racing jacket worn in its starting box.
 */
export function Dog({ coat, jacket, trap, name, running = false, className = '' }: { coat: string; jacket: string; trap: number; name?: string; running?: boolean; className?: string }) {
  const pid = useId().replace(/:/g, '')
  const striped = trap === 6
  const dark = jacket === '#141414' || jacket === '#1d5fd6' || jacket === '#d62828'
  const shade = 'rgba(0,0,0,0.22)'
  return (
    <svg viewBox="0 0 150 80" className={`dog ${running ? 'running' : ''} ${className}`} role="img" aria-label={name ? `Trap ${trap}, ${name}` : `Trap ${trap}`}>
      {striped && (
        <defs>
          <pattern id={pid} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(0)">
            <rect width="8" height="8" fill="#141414" />
            <rect width="4" height="8" fill="#f4f4f4" />
          </pattern>
        </defs>
      )}
      {/* back legs (behind the body) */}
      <g>
        <rect className="leg-b" x="36" y="42" width="7" height="30" rx="3" fill={coat} />
        <rect className="leg-a" x="46" y="42" width="7" height="30" rx="3" fill={shade} />
        <rect className="leg-a" x="36" y="42" width="7" height="30" rx="3" fill="none" />
      </g>
      {/* front legs */}
      <g>
        <rect className="leg-a" x="92" y="40" width="6" height="32" rx="3" fill={shade} />
        <rect className="leg-b" x="100" y="40" width="6" height="32" rx="3" fill={coat} />
      </g>
      <g className="bob">
        {/* tail */}
        <path d="M18 34 C8 30 4 22 2 12" fill="none" stroke={coat} strokeWidth="4" strokeLinecap="round" />
        {/* body: deep chest, tucked waist */}
        <path d="M18 34 C22 20 46 16 70 18 C92 18 108 22 112 34 C110 46 96 50 82 46 C70 42 56 46 40 48 C28 48 18 44 18 34 Z" fill={coat} />
        {/* neck and head */}
        <path d="M100 22 L116 10 L124 14 L112 34 Z" fill={coat} />
        <path d="M114 8 C124 6 138 12 146 22 C147 25 145 27 142 27 L122 27 C116 27 112 22 114 8 Z" fill={coat} />
        <circle cx="146" cy="23" r="2.4" fill="#141414" />
        <path d="M116 8 L112 0 L124 6 Z" fill={shade} />
        <circle cx="128" cy="15" r="1.8" fill="#141414" />
        {/* racing jacket */}
        <path d="M50 17 L86 18 L90 42 L54 44 Z" fill={striped ? `url(#${pid})` : jacket} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
        <text x="70" y="37" textAnchor="middle" fontSize="19" fontWeight="900" fontFamily="system-ui, sans-serif" fill={striped ? '#ffd34d' : dark ? '#ffffff' : '#141414'} stroke={striped ? '#141414' : 'none'} strokeWidth="0.6">{trap}</text>
      </g>
    </svg>
  )
}
