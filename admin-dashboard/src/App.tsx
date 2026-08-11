import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Announcements from './pages/Announcements'
import Emergency from './pages/Emergency'
import Events from './pages/Events'
import ClubFeed from './pages/ClubFeed'
import CheckIn from './pages/CheckIn'
import Academic from './pages/Academic'
import Polls from './pages/Polls'
import LostFound from './pages/LostFound'
import MessMenuPage from './pages/MessMenu'
import Clubs from './pages/Clubs'
import Users from './pages/Users'
import AuditLog from './pages/AuditLog'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.role !== 'super_admin') return <Navigate to="/" replace />
  return <>{children}</>
}

function LoginRoute() {
  const { user } = useAuth()
  if (user) return <Navigate to="/" replace />
  return <Login />
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/announcements" element={<Announcements />} />
              <Route
                path="/emergency"
                element={
                  <RequireSuperAdmin>
                    <Emergency />
                  </RequireSuperAdmin>
                }
              />
              <Route path="/events" element={<Events />} />
              <Route path="/club-feed" element={<ClubFeed />} />
              <Route path="/checkin" element={<CheckIn />} />
              <Route
                path="/academic"
                element={
                  <RequireSuperAdmin>
                    <Academic />
                  </RequireSuperAdmin>
                }
              />
              <Route path="/polls" element={<Polls />} />
              <Route path="/lostfound" element={<LostFound />} />
              <Route path="/mess-menu" element={<MessMenuPage />} />
              <Route path="/clubs" element={<Clubs />} />
              <Route
                path="/users"
                element={
                  <RequireSuperAdmin>
                    <Users />
                  </RequireSuperAdmin>
                }
              />
              <Route
                path="/audit-log"
                element={
                  <RequireSuperAdmin>
                    <AuditLog />
                  </RequireSuperAdmin>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  )
}
