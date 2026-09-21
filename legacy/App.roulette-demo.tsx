import { useRef, useState, useEffect, useCallback, FormEvent } from 'react';

// ─── Demo accounts ────────────────────────────────────────────────────────────
const ACCOUNTS = [
  { username: 'admin',  password: 'admin123',  role: 'admin',  displayName: 'Admin' },
  { username: 'player', password: 'play123',   role: 'player', displayName: 'Player' },
  { username: 'cashier',password: 'cash123',   role: 'cashier',displayName: 'Cashier' },
];

// ─── Floating chips background ────────────────────────────────────────────────
const CHIP_BG = [
  { color:'#dc2626', label:'17', top:'12%', left:'8%',  delay:'0s',    dur:'4.2s' },
  { color:'#16a34a', label:'0',  top:'70%', left:'5%',  delay:'1.1s',  dur:'5s'   },
  { color:'#dc2626', label:'32', top:'30%', left:'88%', delay:'0.4s',  dur:'4.6s' },
  { color:'#1a1a2e', label:'21', top:'75%', left:'85%', delay:'1.8s',  dur:'3.9s' },
  { color:'#dc2626', label:'7',  top:'50%', left:'92%', delay:'0.9s',  dur:'5.2s' },
  { color:'#1a1a2e', label:'13', top:'15%', left:'78%', delay:'2.2s',  dur:'4.1s' },
  { color:'#dc2626', label:'36', top:'88%', left:'50%', delay:'0.2s',  dur:'4.8s' },
  { color:'#16a34a', label:'0',  top:'5%',  left:'45%', delay:'1.5s',  dur:'3.7s' },
];

// ─── Login Page ───────────────────────────────────────────────────────────────
function LoginPage({ onLogin }: { onLogin: (name: string, role: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setTimeout(() => {
      const account = ACCOUNTS.find(
        a => a.username === username.trim().toLowerCase() && a.password === password
      );
      if (account) {
        onLogin(account.displayName, account.role);
      } else {
        setError('Invalid username or password. Please try again.');
        setLoading(false);
      }
    }, 800);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden p-4"
      style={{ background: 'radial-gradient(ellipse at 30% 20%, #1e0a3c 0%, #0a1628 55%, #0d0a1e 100%)' }}
    >
      {/* Floating chip decorations */}
      {CHIP_BG.map((c, i) => (
        <div
          key={i}
          className="float-chip absolute w-12 h-12 rounded-full flex items-center justify-center text-sm font-black text-white select-none pointer-events-none opacity-20"
          style={{ background: c.color, top: c.top, left: c.left, animationDelay: c.delay, animationDuration: c.dur, border: '3px solid rgba(255,255,255,0.3)' }}
        >
          {c.label}
        </div>
      ))}

      {/* Star field */}
      <div className="absolute inset-0 pointer-events-none">
        {Array.from({ length: 60 }, (_, i) => (
          <div key={i} className="absolute rounded-full bg-white"
            style={{ width: Math.random()*2+0.5+'px', height: Math.random()*2+0.5+'px', left: Math.random()*100+'%', top: Math.random()*100+'%', opacity: Math.random()*0.6+0.1 }} />
        ))}
      </div>

      {/* Card */}
      <div
        className="login-card relative w-full max-w-sm rounded-3xl p-8 flex flex-col gap-6"
        style={{ background: 'rgba(13,31,60,0.95)', border: '1px solid rgba(255,215,0,0.25)', boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 60px rgba(220,38,38,0.1)' }}
      >
        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-3"
            style={{ background: 'linear-gradient(135deg, #dc2626, #7c3aed)', boxShadow: '0 8px 24px rgba(220,38,38,0.4)' }}>
            <span className="text-3xl">🎰</span>
          </div>
          <h1 className="text-3xl font-black text-transparent bg-clip-text"
            style={{ fontFamily:"'Abril Fatface', serif", backgroundImage:'linear-gradient(135deg, #ffd700, #ff8c00)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
            ROYAL SPIN
          </h1>
          <p className="text-slate-400 text-sm mt-1 tracking-wide">Sign in to enter the casino</p>
        </div>

        {/* Demo hint */}
        <div className="rounded-xl px-4 py-2.5 text-xs" style={{ background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.2)' }}>
          <p className="text-yellow-400 font-bold mb-1">Demo accounts</p>
          {ACCOUNTS.map(a => (
            <p key={a.username} className="text-slate-400">
              <span className="text-slate-200 font-semibold">{a.username}</span> / <span className="font-mono">{a.password}</span>
              <span className="ml-1 text-yellow-600 uppercase text-[10px]">({a.role})</span>
            </p>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-400">Username</label>
            <input
              className="input-field rounded-xl px-4 py-3 text-sm font-semibold"
              placeholder="Enter username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-400">Password</label>
            <div className="relative">
              <input
                className="input-field rounded-xl px-4 py-3 text-sm font-semibold w-full pr-12"
                type={showPw ? 'text' : 'password'}
                placeholder="Enter password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors text-lg"
              >
                {showPw ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl px-4 py-2.5 text-sm font-semibold text-red-400"
              style={{ background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="login-btn text-white font-black rounded-xl py-3.5 text-base mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ fontFamily:"'Abril Fatface', serif", letterSpacing:'0.04em' }}
          >
            {loading ? '⏳ Signing in…' : '🎲 Enter Casino'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-600">
          By signing in you agree to play responsibly. 18+ only.
        </p>
      </div>
    </div>
  );
}

// ─── Roulette data ────────────────────────────────────────────────────────────
const NUMBERS = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const REDS = new Set([1,3,5,7,9,12,14,16,18,21,23,25,27,30,32,34,36]);
const GREENS = new Set([0]);
function numColor(n: number) {
  if (GREENS.has(n)) return '#16a34a';
  if (REDS.has(n)) return '#dc2626';
  return '#1a1a2e';
}
const SEGMENTS = NUMBERS.map(n => ({ label: String(n), color: numColor(n), number: n }));

// ─── Types ────────────────────────────────────────────────────────────────────
type Bet = { type: string; amount: number };
type TicketStatus = 'pending' | 'won' | 'lost';
type Ticket = {
  id: string;
  createdAt: Date;
  playerName: string;
  bets: Bet[];
  totalBet: number;
  status: TicketStatus;
  result?: number;
  payout: number;
};

type View = 'game' | 'cashier' | 'checker' | 'dashboard';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function genTicketId() {
  return 'TKT-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function calcPayout(bets: Bet[], resultNum: number): number {
  let w = 0;
  bets.forEach(bet => {
    if (bet.type === 'red' && REDS.has(resultNum)) w += bet.amount * 2;
    if (bet.type === 'black' && !REDS.has(resultNum) && resultNum !== 0) w += bet.amount * 2;
    if (bet.type === 'green' && resultNum === 0) w += bet.amount * 14;
    if (bet.type === `num-${resultNum}`) w += bet.amount * 36;
    if (bet.type === 'odd' && resultNum !== 0 && resultNum % 2 === 1) w += bet.amount * 2;
    if (bet.type === 'even' && resultNum !== 0 && resultNum % 2 === 0) w += bet.amount * 2;
    if (bet.type === '1-18' && resultNum >= 1 && resultNum <= 18) w += bet.amount * 2;
    if (bet.type === '19-36' && resultNum >= 19 && resultNum <= 36) w += bet.amount * 2;
  });
  return w;
}

// ─── Confetti ─────────────────────────────────────────────────────────────────
const CONFETTI_COLORS = ['#dc2626','#16a34a','#ffd700','#fff','#a855f7'];
function Confetti() {
  const pieces = Array.from({ length: 60 }, (_, i) => ({
    id: i, left: Math.random() * 100, delay: Math.random() * 1.5,
    duration: 2.5 + Math.random() * 2,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    size: 6 + Math.random() * 10, shape: Math.random() > 0.5 ? 'circle' : 'square',
  }));
  return <>
    {pieces.map(p => (
      <div key={p.id} className="confetti-piece" style={{
        left: `${p.left}%`, top: 0, width: p.size, height: p.size,
        backgroundColor: p.color, borderRadius: p.shape === 'circle' ? '50%' : '2px',
        animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`,
      }} />
    ))}
  </>;
}

// ─── Wheel drawing ────────────────────────────────────────────────────────────
function drawWheel(canvas: HTMLCanvasElement, rotation: number) {
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width, cx = size / 2, cy = size / 2;
  const radius = size / 2 - 8;
  const arc = (2 * Math.PI) / SEGMENTS.length;
  ctx.clearRect(0, 0, size, size);
  SEGMENTS.forEach((seg, i) => {
    const startAngle = rotation + i * arc, endAngle = startAngle + arc, midAngle = startAngle + arc / 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, startAngle, endAngle); ctx.closePath();
    ctx.fillStyle = seg.color; ctx.fill();
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, 'rgba(255,255,255,0.12)'); grad.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, startAngle, endAngle); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + radius * Math.cos(startAngle), cy + radius * Math.sin(startAngle));
    ctx.strokeStyle = 'rgba(255,215,0,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(midAngle); ctx.textAlign = 'right';
    ctx.fillStyle = '#fff'; ctx.font = `bold ${size < 400 ? 9 : 10}px 'Outfit', sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3;
    ctx.fillText(seg.label, radius - 10, 4); ctx.restore();
  });
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 4; ctx.stroke();
  const hubGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28);
  hubGrad.addColorStop(0, '#fff8dc'); hubGrad.addColorStop(0.5, '#ffd700'); hubGrad.addColorStop(1, '#b8860b');
  ctx.beginPath(); ctx.arc(cx, cy, 28, 0, 2 * Math.PI); ctx.fillStyle = hubGrad; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = 'bold 16px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1a1a2e'; ctx.shadowColor = 'transparent'; ctx.fillText('★', cx, cy);
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-1" style={{ background: '#0d1f3c', border: '1px solid #1e3a5f' }}>
      <p className="text-xs uppercase tracking-widest font-bold" style={{ color: '#64748b' }}>{label}</p>
      <p className="text-3xl font-black" style={{ fontFamily: "'Abril Fatface', serif", color: accent || '#ffd700' }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: '#64748b' }}>{sub}</p>}
    </div>
  );
}

// ─── Root (login gate) ────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState<{ name: string; role: string } | null>(null);
  if (!session) return <LoginPage onLogin={(name, role) => setSession({ name, role })} />;
  return <Casino playerName={session.name} role={session.role} onLogout={() => setSession(null)} />;
}

// ─── Main Casino App ──────────────────────────────────────────────────────────
function Casino({ playerName: initName, role, onLogout }: { playerName: string; role: string; onLogout: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>('game');
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [winner, setWinner] = useState<typeof SEGMENTS[0] | null>(null);
  const [showWinner, setShowWinner] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [balance, setBalance] = useState(1000);
  const [betAmount, setBetAmount] = useState(10);
  const [bets, setBets] = useState<Bet[]>([]);
  const [playerName] = useState(initName);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [history, setHistory] = useState<{ number: number; color: string }[]>([]);
  const [currentTicket, setCurrentTicket] = useState<Ticket | null>(null);
  // Checker
  const [checkInput, setCheckInput] = useState('');
  const [checkedTicket, setCheckedTicket] = useState<Ticket | null | 'not-found'>('not-found');
  const [searched, setSearched] = useState(false);
  // Cashier
  const [cashierFilter, setCashierFilter] = useState<'all' | TicketStatus>('all');
  const animFrameRef = useRef<number>(0);
  const rotRef = useRef(0);

  const redraw = useCallback((rot: number) => {
    const c = canvasRef.current; if (c) drawWheel(c, rot);
  }, []);
  useEffect(() => { redraw(rotation); }, [redraw, rotation]);

  const totalBet = bets.reduce((s, b) => s + b.amount, 0);

  const addBet = (type: string) => {
    if (spinning || betAmount <= 0 || betAmount > balance) return;
    setBets(prev => {
      const ex = prev.find(b => b.type === type);
      return ex ? prev.map(b => b.type === type ? { ...b, amount: b.amount + betAmount } : b)
                : [...prev, { type, amount: betAmount }];
    });
    setBalance(b => b - betAmount);
  };

  const clearBets = () => {
    if (spinning) return;
    setBalance(b => b + totalBet);
    setBets([]);
  };

  const spin = useCallback(() => {
    if (spinning || bets.length === 0) return;
    const ticketId = genTicketId();
    const ticketBets = [...bets];
    const ticketTotal = totalBet;
    const pendingTicket: Ticket = {
      id: ticketId, createdAt: new Date(), playerName,
      bets: ticketBets, totalBet: ticketTotal, status: 'pending', payout: 0,
    };
    setCurrentTicket(pendingTicket);
    setTickets(prev => [pendingTicket, ...prev]);
    setWinner(null); setShowWinner(false); setShowConfetti(false); setSpinning(true);

    const totalAngle = (10 + Math.random() * 5) * 2 * Math.PI + Math.random() * 2 * Math.PI;
    const duration = 5000 + Math.random() * 2000;
    const startTime = performance.now();
    const startRot = rotRef.current;
    const ease = (t: number) => 1 - Math.pow(1 - t, 4);

    function frame(now: number) {
      const t = Math.min((now - startTime) / duration, 1);
      const cur = startRot + totalAngle * ease(t);
      rotRef.current = cur;
      redraw(cur);
      if (t < 1) { animFrameRef.current = requestAnimationFrame(frame); return; }
      setRotation(cur);
      const arc = (2 * Math.PI) / SEGMENTS.length;
      const norm = ((cur % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const ptr = (((-Math.PI / 2 - norm) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const seg = SEGMENTS[Math.floor(ptr / arc) % SEGMENTS.length];
      const payout = calcPayout(ticketBets, seg.number);
      const won = payout > 0;
      const finalTicket: Ticket = { ...pendingTicket, status: won ? 'won' : 'lost', result: seg.number, payout };
      setTickets(prev => prev.map(t => t.id === ticketId ? finalTicket : t));
      setCurrentTicket(finalTicket);
      setBalance(b => b + payout);
      setBets([]);
      setWinner(seg);
      setHistory(h => [{ number: seg.number, color: seg.color }, ...h].slice(0, 15));
      setSpinning(false);
      setTimeout(() => {
        setShowWinner(true);
        if (won) { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 4500); }
      }, 300);
    }
    animFrameRef.current = requestAnimationFrame(frame);
  }, [spinning, bets, totalBet, playerName, redraw]);

  useEffect(() => () => cancelAnimationFrame(animFrameRef.current), []);

  const checkTicket = () => {
    const t = tickets.find(t => t.id === checkInput.trim().toUpperCase());
    setCheckedTicket(t ?? 'not-found');
    setSearched(true);
  };

  // Dashboard stats
  const totalRevenue = tickets.filter(t => t.status !== 'pending').reduce((s, t) => s + t.totalBet, 0);
  const totalPayouts = tickets.filter(t => t.status !== 'pending').reduce((s, t) => s + t.payout, 0);
  const netProfit = totalRevenue - totalPayouts;
  const totalTickets = tickets.length;
  const wonTickets = tickets.filter(t => t.status === 'won').length;

  const filteredTickets = cashierFilter === 'all' ? tickets : tickets.filter(t => t.status === cashierFilter);

  const NAV = [
    { id: 'game' as View,      label: '🎰 Game',         roles: ['admin','player','cashier'] },
    { id: 'cashier' as View,   label: '🧾 Cashier',      roles: ['admin','cashier'] },
    { id: 'checker' as View,   label: '🔍 Ticket Check', roles: ['admin','player','cashier'] },
    { id: 'dashboard' as View, label: '📊 Dashboard',    roles: ['admin'] },
  ].filter(n => n.roles.includes(role));

  const CHIPS = [5, 10, 25, 50, 100, 500];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0a1628', fontFamily: "'Outfit', sans-serif" }}>
      {showConfetti && <Confetti />}

      {/* Header */}
      <header className="flex items-center justify-between px-4 md:px-6 py-3 shrink-0" style={{ background: '#0d1f3c', borderBottom: '1px solid #1e3a5f' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl md:text-2xl font-black" style={{ fontFamily: "'Abril Fatface', serif", background: 'linear-gradient(135deg, #ffd700, #ff8c00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            ROYAL SPIN
          </span>
          <span className="text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider" style={{ background: '#dc2626', color: '#fff' }}>LIVE</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex flex-col items-end">
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-sm">{playerName}</span>
              <span className="text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider"
                style={{ background: role==='admin'?'rgba(168,85,247,0.3)':role==='cashier'?'rgba(59,130,246,0.3)':'rgba(22,163,74,0.3)', color: role==='admin'?'#c084fc':role==='cashier'?'#60a5fa':'#4ade80', border: `1px solid ${role==='admin'?'#7c3aed':role==='cashier'?'#2563eb':'#16a34a'}` }}>
                {role}
              </span>
            </div>
            {role !== 'cashier' && (
              <p className="text-lg font-bold text-yellow-400 leading-none">${balance.toLocaleString()}</p>
            )}
          </div>
          {balance < 50 && role !== 'cashier' && (
            <button onClick={() => setBalance(b => b + 1000)} className="px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ background: '#16a34a' }}>+$1000</button>
          )}
          <button
            onClick={onLogout}
            className="px-3 py-2 rounded-lg text-sm font-bold transition-opacity hover:opacity-80"
            style={{ background: 'rgba(220,38,38,0.15)', color: '#f87171', border: '1px solid rgba(220,38,38,0.3)' }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Nav */}
      <nav className="flex shrink-0" style={{ background: '#091525', borderBottom: '1px solid #1e3a5f' }}>
        {NAV.map(n => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className="flex-1 py-3 text-xs md:text-sm font-bold uppercase tracking-wider transition-colors"
            style={{
              color: view === n.id ? '#ffd700' : '#64748b',
              borderBottom: view === n.id ? '2px solid #ffd700' : '2px solid transparent',
              background: 'transparent',
            }}
          >
            {n.label}
          </button>
        ))}
      </nav>

      {/* ── GAME VIEW ── */}
      {view === 'game' && (
        <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
          {/* Left sidebar — history */}
          <aside className="hidden lg:flex flex-col gap-3 p-4 overflow-y-auto shrink-0" style={{ width: 220, background: '#0d1f3c', borderRight: '1px solid #1e3a5f' }}>
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Recent Results</p>
            <div className="flex flex-wrap gap-1.5">
              {history.length === 0 && <span className="text-slate-500 text-sm">No spins yet</span>}
              {history.map((h, i) => (
                <span key={i} className="w-8 h-8 flex items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: h.color, border: '2px solid rgba(255,255,255,0.2)' }}>
                  {h.number}
                </span>
              ))}
            </div>
            {currentTicket && (
              <div className="mt-3 rounded-xl p-3" style={{ background: '#091525', border: '1px solid #1e3a5f' }}>
                <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-1">Last Ticket</p>
                <p className="text-yellow-400 font-mono font-bold text-sm">{currentTicket.id}</p>
                <p className="text-xs text-slate-400 mt-1">{currentTicket.bets.length} bet(s) · ${currentTicket.totalBet}</p>
                <div className="mt-1.5 inline-block px-2 py-0.5 rounded text-xs font-bold"
                  style={{
                    background: currentTicket.status === 'won' ? 'rgba(22,163,74,0.2)' : currentTicket.status === 'lost' ? 'rgba(220,38,38,0.2)' : 'rgba(250,204,21,0.2)',
                    color: currentTicket.status === 'won' ? '#4ade80' : currentTicket.status === 'lost' ? '#f87171' : '#fbbf24',
                  }}>
                  {currentTicket.status.toUpperCase()}
                </div>
                {currentTicket.payout > 0 && <p className="text-green-400 font-bold text-sm mt-1">+${currentTicket.payout}</p>}
              </div>
            )}
          </aside>

          {/* Center — wheel */}
          <main className="flex-1 flex flex-col items-center justify-center gap-4 p-4 overflow-y-auto">
            <div className="relative flex flex-col items-center">
              <div className="absolute left-1/2 z-20" style={{ top: -2, transform: 'translateX(-50%)' }}>
                <div style={{ width: 0, height: 0, borderLeft: '12px solid transparent', borderRight: '12px solid transparent', borderTop: '30px solid #ffd700', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.8))' }} />
              </div>
              <div style={{ padding: 5, background: 'conic-gradient(#ffd700, #ff8c00, #dc2626, #16a34a, #ffd700)', borderRadius: '50%' }}>
                <canvas ref={canvasRef} width={460} height={460} className="block rounded-full"
                  style={{ maxWidth: 'min(75vw, 460px)', maxHeight: 'min(75vw, 460px)' }} />
              </div>
            </div>
            {/* Chip selector */}
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs uppercase tracking-widest text-slate-400">Select Chip</p>
              <div className="flex gap-2 flex-wrap justify-center">
                {CHIPS.map(amt => (
                  <button key={amt} onClick={() => setBetAmount(amt)}
                    className="w-12 h-12 rounded-full font-black text-sm transition-all hover:scale-110 border-2"
                    style={{ background: betAmount === amt ? '#ffd700' : '#1e3a5f', color: betAmount === amt ? '#0a1628' : '#fff', borderColor: betAmount === amt ? '#ffd700' : '#2d5a8e', boxShadow: betAmount === amt ? '0 0 16px rgba(255,215,0,0.6)' : 'none' }}>
                    {amt >= 1000 ? `${amt/1000}k` : amt}
                  </button>
                ))}
              </div>
            </div>
            {/* Spin btn */}
            <div className="flex gap-3">
              {bets.length > 0 && (
                <button onClick={clearBets} disabled={spinning} className="px-5 py-3 rounded-xl font-bold border transition-opacity hover:opacity-80"
                  style={{ borderColor: '#dc2626', color: '#f87171', background: 'rgba(220,38,38,0.1)' }}>Clear</button>
              )}
              <button className="btn-spin text-white rounded-xl px-8 py-4 text-xl shadow-2xl"
                style={{ fontFamily: "'Abril Fatface', serif", opacity: bets.length === 0 ? 0.4 : 1 }}
                onClick={spin} disabled={spinning || bets.length === 0}>
                {spinning ? 'Spinning…' : bets.length === 0 ? 'Place a Bet First' : `🎰 SPIN · $${totalBet}`}
              </button>
            </div>
          </main>

          {/* Right — betting board */}
          <aside className="flex flex-col gap-3 p-4 overflow-y-auto shrink-0" style={{ width: 270, background: '#0d1f3c', borderLeft: '1px solid #1e3a5f' }}>
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Place Bets</p>
            {/* Color bets */}
            <div className="grid grid-cols-3 gap-2">
              {[{ type:'red',label:'RED',color:'#dc2626',odds:'2×'},{ type:'black',label:'BLACK',color:'#1a1a2e',odds:'2×'},{ type:'green',label:'0',color:'#16a34a',odds:'14×'}].map(b => (
                <button key={b.type} onClick={() => addBet(b.type)} disabled={spinning}
                  className="flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-all hover:scale-105"
                  style={{ background: b.color, borderColor: bets.find(x=>x.type===b.type) ? '#ffd700' : 'rgba(255,255,255,0.15)' }}>
                  <span className="text-white font-black text-sm">{b.label}</span>
                  <span className="text-yellow-300 text-xs font-bold">{b.odds}</span>
                  {bets.find(x=>x.type===b.type) && <span className="text-yellow-200 text-xs">${bets.find(x=>x.type===b.type)!.amount}</span>}
                </button>
              ))}
            </div>
            {/* Parity/range */}
            <div className="grid grid-cols-2 gap-2">
              {[{type:'odd',label:'ODD',odds:'2×'},{type:'even',label:'EVEN',odds:'2×'},{type:'1-18',label:'1–18',odds:'2×'},{type:'19-36',label:'19–36',odds:'2×'}].map(b => (
                <button key={b.type} onClick={() => addBet(b.type)} disabled={spinning}
                  className="flex justify-between items-center px-3 py-2.5 rounded-xl border text-sm font-bold transition-all hover:scale-105"
                  style={{ background: bets.find(x=>x.type===b.type) ? 'rgba(255,215,0,0.12)' : 'rgba(255,255,255,0.05)', borderColor: bets.find(x=>x.type===b.type) ? '#ffd700' : '#1e3a5f', color: '#fff' }}>
                  <span>{b.label}</span><span className="text-yellow-400">{b.odds}</span>
                </button>
              ))}
            </div>
            {/* Number grid */}
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-1.5">Straight Up (36×)</p>
              <div className="grid grid-cols-6 gap-1">
                <button onClick={() => addBet('num-0')} disabled={spinning}
                  className="col-span-6 py-1.5 rounded font-black text-sm text-white border transition-all hover:scale-105"
                  style={{ background:'#16a34a', borderColor: bets.find(x=>x.type==='num-0') ? '#ffd700':'transparent' }}>0</button>
                {Array.from({length:36},(_,i)=>i+1).map(n => (
                  <button key={n} onClick={() => addBet(`num-${n}`)} disabled={spinning}
                    className="py-1.5 rounded font-black text-xs text-white border transition-all hover:scale-110"
                    style={{ background: REDS.has(n)?'#dc2626':'#1a1a2e', borderColor: bets.find(x=>x.type===`num-${n}`) ? '#ffd700':'rgba(255,255,255,0.1)', boxShadow: bets.find(x=>x.type===`num-${n}`) ? '0 0 8px rgba(255,215,0,0.5)':'none' }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ── CASHIER VIEW ── */}
      {view === 'cashier' && (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-black text-white" style={{ fontFamily: "'Abril Fatface', serif" }}>Cashier Panel</h2>
                <p className="text-slate-400 text-sm mt-0.5">{tickets.length} total tickets issued</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {(['all','pending','won','lost'] as const).map(f => (
                  <button key={f} onClick={() => setCashierFilter(f)}
                    className="px-4 py-2 rounded-lg text-sm font-bold capitalize transition-all"
                    style={{ background: cashierFilter === f ? '#ffd700' : '#1e3a5f', color: cashierFilter === f ? '#0a1628' : '#94a3b8' }}>
                    {f} {f !== 'all' && `(${tickets.filter(t=>t.status===f).length})`}
                  </button>
                ))}
              </div>
            </div>

            {filteredTickets.length === 0 ? (
              <div className="text-center py-20 text-slate-500">
                <p className="text-5xl mb-3">🎟️</p>
                <p className="text-lg font-semibold">No tickets yet</p>
                <p className="text-sm mt-1">Play the game to generate tickets</p>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #1e3a5f' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#091525' }}>
                      {['Ticket ID','Player','Time','Bets','Staked','Result','Payout','Status'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider font-bold" style={{ color: '#64748b' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTickets.map((t, i) => (
                      <tr key={t.id} style={{ background: i % 2 === 0 ? '#0d1f3c' : '#091525', borderTop: '1px solid #1e3a5f' }}>
                        <td className="px-4 py-3 font-mono font-bold text-yellow-400">{t.id}</td>
                        <td className="px-4 py-3 text-white font-semibold">{t.playerName}</td>
                        <td className="px-4 py-3 text-slate-400">{t.createdAt.toLocaleTimeString()}</td>
                        <td className="px-4 py-3 text-slate-300">{t.bets.map(b=>b.type.replace('num-','#')).join(', ')}</td>
                        <td className="px-4 py-3 text-white font-bold">${t.totalBet}</td>
                        <td className="px-4 py-3">
                          {t.result !== undefined ? (
                            <span className="w-8 h-8 inline-flex items-center justify-center rounded-full text-xs font-black text-white"
                              style={{ background: numColor(t.result) }}>
                              {t.result}
                            </span>
                          ) : <span className="text-slate-500">—</span>}
                        </td>
                        <td className="px-4 py-3 font-bold" style={{ color: t.payout > 0 ? '#4ade80' : '#64748b' }}>
                          {t.payout > 0 ? `+$${t.payout}` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded text-xs font-bold"
                            style={{
                              background: t.status==='won'?'rgba(22,163,74,0.2)':t.status==='lost'?'rgba(220,38,38,0.15)':'rgba(250,204,21,0.15)',
                              color: t.status==='won'?'#4ade80':t.status==='lost'?'#f87171':'#fbbf24',
                            }}>
                            {t.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TICKET CHECKER ── */}
      {view === 'checker' && (
        <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col items-center">
          <div className="w-full max-w-lg">
            <div className="text-center mb-8">
              <p className="text-5xl mb-3">🔍</p>
              <h2 className="text-3xl font-black text-white mb-1" style={{ fontFamily: "'Abril Fatface', serif" }}>Check Your Ticket</h2>
              <p className="text-slate-400 text-sm">Enter your ticket number to see if you've won</p>
            </div>

            <div className="rounded-2xl p-6" style={{ background: '#0d1f3c', border: '1px solid #1e3a5f' }}>
              <label className="block text-xs uppercase tracking-widest text-slate-400 font-bold mb-2">Ticket Number</label>
              <div className="flex gap-2">
                <input
                  value={checkInput}
                  onChange={e => { setCheckInput(e.target.value.toUpperCase()); setSearched(false); }}
                  onKeyDown={e => e.key === 'Enter' && checkTicket()}
                  placeholder="e.g. TKT-AB12CD"
                  className="flex-1 rounded-xl px-4 py-3 text-white font-mono font-bold text-lg"
                  style={{ background: '#091525', border: '2px solid #1e3a5f', outline: 'none' }}
                />
                <button onClick={checkTicket}
                  className="px-6 py-3 rounded-xl font-bold text-white transition-all hover:scale-105"
                  style={{ background: 'linear-gradient(135deg, #dc2626, #7c3aed)' }}>
                  Check
                </button>
              </div>
            </div>

            {searched && (
              <div className="mt-6">
                {checkedTicket === 'not-found' || !checkedTicket ? (
                  <div className="rounded-2xl p-6 text-center" style={{ background: '#0d1f3c', border: '1px solid #dc2626' }}>
                    <p className="text-4xl mb-2">❌</p>
                    <p className="text-red-400 font-bold text-lg">Ticket not found</p>
                    <p className="text-slate-400 text-sm mt-1">Please check the ticket number and try again</p>
                  </div>
                ) : (
                  <div className="rounded-2xl p-6" style={{
                    background: '#0d1f3c',
                    border: `2px solid ${checkedTicket.status==='won'?'#16a34a':checkedTicket.status==='lost'?'#dc2626':'#fbbf24'}`,
                    boxShadow: `0 0 40px ${checkedTicket.status==='won'?'rgba(22,163,74,0.2)':checkedTicket.status==='lost'?'rgba(220,38,38,0.15)':'rgba(251,191,36,0.15)'}`,
                  }}>
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Ticket</p>
                        <p className="text-yellow-400 font-mono font-black text-xl">{checkedTicket.id}</p>
                      </div>
                      <span className="px-3 py-1 rounded-lg font-black text-sm"
                        style={{
                          background: checkedTicket.status==='won'?'rgba(22,163,74,0.25)':checkedTicket.status==='lost'?'rgba(220,38,38,0.2)':'rgba(251,191,36,0.2)',
                          color: checkedTicket.status==='won'?'#4ade80':checkedTicket.status==='lost'?'#f87171':'#fbbf24',
                        }}>
                        {checkedTicket.status === 'won' ? '🏆 WON' : checkedTicket.status === 'lost' ? '❌ LOST' : '⏳ PENDING'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="rounded-xl p-3" style={{ background: '#091525' }}>
                        <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Player</p>
                        <p className="text-white font-bold">{checkedTicket.playerName}</p>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: '#091525' }}>
                        <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Time</p>
                        <p className="text-white font-bold">{checkedTicket.createdAt.toLocaleTimeString()}</p>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: '#091525' }}>
                        <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Amount Staked</p>
                        <p className="text-white font-bold">${checkedTicket.totalBet}</p>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: '#091525' }}>
                        <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Winning Number</p>
                        {checkedTicket.result !== undefined ? (
                          <span className="inline-flex w-8 h-8 items-center justify-center rounded-full text-xs font-black text-white"
                            style={{ background: numColor(checkedTicket.result) }}>
                            {checkedTicket.result}
                          </span>
                        ) : <p className="text-slate-500">—</p>}
                      </div>
                    </div>

                    <div className="rounded-xl p-3 mb-4" style={{ background: '#091525' }}>
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Bets Placed</p>
                      <div className="flex flex-wrap gap-2">
                        {checkedTicket.bets.map((b, i) => (
                          <span key={i} className="px-2 py-1 rounded text-xs font-bold text-white"
                            style={{ background: '#1e3a5f' }}>
                            {b.type.replace('num-','#')} · ${b.amount}
                          </span>
                        ))}
                      </div>
                    </div>

                    {checkedTicket.status === 'won' && (
                      <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(22,163,74,0.15)', border: '1px solid #16a34a' }}>
                        <p className="text-green-400 text-sm font-bold uppercase tracking-wider mb-1">Total Payout</p>
                        <p className="text-4xl font-black text-green-400" style={{ fontFamily: "'Abril Fatface', serif" }}>${checkedTicket.payout}</p>
                        <p className="text-green-600 text-xs mt-1">Profit: +${checkedTicket.payout - checkedTicket.totalBet}</p>
                      </div>
                    )}
                    {checkedTicket.status === 'lost' && (
                      <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid #dc2626' }}>
                        <p className="text-red-400 font-bold">Better luck next time!</p>
                        <p className="text-red-600 text-xs mt-1">Lost: ${ checkedTicket.totalBet}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Recent tickets quick-access */}
            {tickets.length > 0 && (
              <div className="mt-6">
                <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-3">Recent Tickets</p>
                <div className="flex flex-col gap-2">
                  {tickets.slice(0, 5).map(t => (
                    <button key={t.id} onClick={() => { setCheckInput(t.id); setCheckedTicket(t); setSearched(true); }}
                      className="flex items-center justify-between rounded-xl px-4 py-3 text-left transition-all hover:scale-[1.01]"
                      style={{ background: '#0d1f3c', border: '1px solid #1e3a5f' }}>
                      <div>
                        <p className="text-yellow-400 font-mono font-bold text-sm">{t.id}</p>
                        <p className="text-slate-400 text-xs">{t.playerName} · ${t.totalBet}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded text-xs font-bold"
                        style={{
                          background: t.status==='won'?'rgba(22,163,74,0.2)':t.status==='lost'?'rgba(220,38,38,0.15)':'rgba(251,191,36,0.15)',
                          color: t.status==='won'?'#4ade80':t.status==='lost'?'#f87171':'#fbbf24',
                        }}>
                        {t.status.toUpperCase()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DASHBOARD ── */}
      {view === 'dashboard' && (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-5xl mx-auto">
            <div className="mb-6">
              <h2 className="text-2xl font-black text-white" style={{ fontFamily: "'Abril Fatface', serif" }}>Revenue Dashboard</h2>
              <p className="text-slate-400 text-sm mt-0.5">Live stats from all spins this session</p>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard label="Total Revenue" value={`$${totalRevenue.toLocaleString()}`} sub="Total amount staked" accent="#ffd700" />
              <StatCard label="Total Payouts" value={`$${totalPayouts.toLocaleString()}`} sub="Paid to players" accent="#f87171" />
              <StatCard label="Net Profit" value={`$${netProfit.toLocaleString()}`} sub={netProfit >= 0 ? 'House is winning' : 'House is losing'} accent={netProfit >= 0 ? '#4ade80' : '#f87171'} />
              <StatCard label="Tickets Issued" value={String(totalTickets)} sub={`${wonTickets} winners`} accent="#a78bfa" />
            </div>

            {/* Secondary stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <StatCard label="House Edge" value={totalRevenue > 0 ? `${((netProfit/totalRevenue)*100).toFixed(1)}%` : '—'} sub="Profit margin" accent="#fb923c" />
              <StatCard label="Win Rate" value={totalTickets > 0 ? `${((wonTickets/totalTickets)*100).toFixed(1)}%` : '—'} sub="Players who won" accent="#34d399" />
              <StatCard label="Avg Stake" value={totalTickets > 0 ? `$${(totalRevenue/totalTickets).toFixed(0)}` : '—'} sub="Per ticket" accent="#60a5fa" />
            </div>

            {/* Per-number results */}
            {history.length > 0 && (
              <div className="rounded-2xl p-6" style={{ background: '#0d1f3c', border: '1px solid #1e3a5f' }}>
                <h3 className="text-sm uppercase tracking-widest font-bold text-slate-400 mb-4">Number Frequency (this session)</h3>
                <div className="flex flex-wrap gap-2">
                  {Array.from(new Set(history.map(h=>h.number))).map(n => {
                    const count = history.filter(h=>h.number===n).length;
                    return (
                      <div key={n} className="flex flex-col items-center gap-1">
                        <span className="w-9 h-9 flex items-center justify-center rounded-full text-xs font-black text-white"
                          style={{ background: numColor(n), border: '2px solid rgba(255,255,255,0.2)' }}>
                          {n}
                        </span>
                        <span className="text-xs font-bold text-slate-400">{count}×</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {totalTickets === 0 && (
              <div className="text-center py-16 text-slate-500">
                <p className="text-5xl mb-3">📊</p>
                <p className="text-lg font-semibold">No data yet</p>
                <p className="text-sm mt-1">Play the game to generate revenue stats</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Winner overlay */}
      {showWinner && winner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
          onClick={() => setShowWinner(false)}>
          <div className="winner-card rounded-3xl p-8 text-center max-w-xs w-full"
            style={{ background: '#0d1f3c', border: `3px solid ${winner.color}`, boxShadow: `0 0 60px ${winner.color}90` }}
            onClick={e => e.stopPropagation()}>
            <p className="text-slate-400 uppercase tracking-widest text-xs font-bold mb-1">Winning Number</p>
            <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl font-black text-white mx-auto mb-3"
              style={{ background: winner.color, boxShadow: `0 0 30px ${winner.color}` }}>
              {winner.label}
            </div>
            {currentTicket && (
              <>
                <p className="text-yellow-400 font-mono font-bold text-sm mb-1">{currentTicket.id}</p>
                {currentTicket.payout > 0
                  ? <p className="text-2xl font-black text-green-400 mb-4">🎉 +${currentTicket.payout}</p>
                  : <p className="text-lg font-bold text-red-400 mb-4">💸 Better luck next time!</p>
                }
              </>
            )}
            <button onClick={() => setShowWinner(false)}
              className="rounded-xl px-8 py-3 font-bold text-white text-base w-full hover:scale-105 transition-transform"
              style={{ background: 'linear-gradient(135deg, #dc2626, #7c3aed)' }}>
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
