import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import type { User } from '@/lib/api'
import Display from '@/pages/Display'
import StaffLogin from '@/pages/StaffLogin'

const DogDisplay = lazy(() => import('@dog/web/DogDisplay'))
const PosApp = lazy(() => import('@/pages/pos/PosApp'))
const AdminApp = lazy(() => import('@/pages/admin/AdminApp'))

/** Shows the area's own sign-in until someone with the right role is signed in. */
function Gate({ area, roles, children }: { area: 'cashier' | 'admin'; roles: User['role'][]; children: ReactNode }) {
  const auth = useAuth()
  if (!auth || !roles.includes(auth.user.role)) return <StaffLogin area={area} />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-6 text-sm text-mute">Loading…</div>}>
        <Routes>
          {/* Players: the game screen is always the first page, with no sign-in */}
          <Route path="/" element={<Display />} />
          <Route path="/display" element={<Display />} />
          <Route path="/dogs" element={<DogDisplay />} />
          {/* Staff */}
          <Route path="/cashier/*" element={<Gate area="cashier" roles={['CASHIER']}><PosApp /></Gate>} />
          <Route path="/admin/*" element={<Gate area="admin" roles={['ADMIN', 'MANAGER']}><AdminApp /></Gate>} />
          <Route path="/pos/*" element={<Navigate to="/cashier" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
