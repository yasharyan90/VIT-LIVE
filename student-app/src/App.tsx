import { Navigate, Route, Routes } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from './lib/auth'
import { ToastProvider } from './lib/toast'
import { Shell } from './components/Shell'
import { LoginPage } from './pages/auth/Login'
import { SignupPage } from './pages/auth/Signup'
import { OtpPage } from './pages/auth/Otp'
import { FeedPage } from './pages/Feed'
import { LostFoundPage } from './pages/LostFound'
import { LostFoundNewPage } from './pages/LostFoundNew'
import { LostFoundDetailPage } from './pages/LostFoundDetail'
import { EventsPage } from './pages/Events'
import { EventDetailPage } from './pages/EventDetail'
import { PollsPage } from './pages/Polls'
import { PollDetailPage } from './pages/PollDetail'
import { ClubPage } from './pages/ClubPage'
import { ProfilePage } from './pages/Profile'

function Splash() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-center justify-center gap-3 text-ink">
      <motion.span
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className="text-5xl grayscale"
        aria-hidden="true"
      >
        🎓
      </motion.span>
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-3xl font-extrabold tracking-tight"
      >
        VIT<span className="text-muted"> Live</span>
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="text-sm text-muted"
      >
        Your campus, in real time
      </motion.p>
      <span
        className="mt-4 inline-block h-7 w-7 animate-spin rounded-full border-[3px] border-white/15 border-t-white"
        role="status"
        aria-label="Loading"
      />
    </div>
  )
}

export default function App() {
  const { user, booting } = useAuth()

  if (booting) return <Splash />

  return (
    <ToastProvider>
      <Routes>
        {user ? (
          <>
            <Route element={<Shell />}>
              <Route index element={<FeedPage />} />
              <Route path="lostfound" element={<LostFoundPage />} />
              <Route path="lostfound/new" element={<LostFoundNewPage />} />
              <Route path="lostfound/:id" element={<LostFoundDetailPage />} />
              <Route path="events" element={<EventsPage />} />
              <Route path="events/:id" element={<EventDetailPage />} />
              <Route path="polls" element={<PollsPage />} />
              <Route path="polls/:id" element={<PollDetailPage />} />
              <Route path="clubs/:id" element={<ClubPage />} />
              <Route path="profile" element={<ProfilePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/verify-otp" element={<OtpPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        )}
      </Routes>
    </ToastProvider>
  )
}
