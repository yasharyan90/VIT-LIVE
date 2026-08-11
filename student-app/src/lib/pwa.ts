// PWA plumbing: service-worker registration (offline shell + push display)
// and FCM web-push token registration.
//
// Push activates only when the Firebase env vars are present at build time
// (VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID,
// VITE_FIREBASE_SENDER_ID, VITE_FCM_VAPID_KEY) — mirroring the backend,
// which only sends real pushes when FCM_SERVICE_ACCOUNT_JSON is set.

import { api } from './api'

let registration: ServiceWorkerRegistration | null = null

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  try {
    registration = await navigator.serviceWorker.register('/sw.js')
  } catch {
    // offline support is progressive enhancement — never block the app
  }
}

const fbConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID as string | undefined,
}
const vapidKey = import.meta.env.VITE_FCM_VAPID_KEY as string | undefined

export function pushConfigured(): boolean {
  return Boolean(fbConfig.apiKey && fbConfig.projectId && fbConfig.appId && fbConfig.messagingSenderId && vapidKey)
}

// Call after login. Asks for notification permission, mints an FCM token
// bound to our service worker, and registers it with the backend.
export async function registerPush(): Promise<void> {
  if (!pushConfigured() || !('Notification' in window) || !registration) return
  try {
    if (Notification.permission === 'default') {
      await Notification.requestPermission()
    }
    if (Notification.permission !== 'granted') return

    const { initializeApp } = await import('firebase/app')
    const { getMessaging, getToken } = await import('firebase/messaging')
    const app = initializeApp(fbConfig as Record<string, string>)
    const messaging = getMessaging(app)
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    })
    if (token) {
      await api('/me/device-token', { body: { fcm_token: token, platform: 'web' } })
    }
  } catch {
    // push is best-effort; WS delivery covers the foreground path
  }
}
