import type { useLiveStore } from '../stores/live'

/** Both entry forms join once, preserving a saved quiz nickname when available. */
export async function joinPresentation(live: ReturnType<typeof useLiveStore>, accessCode: string) {
  await live.join(accessCode)
  const saved = localStorage.getItem('livepoll.nickname')
  if (saved?.trim()) {
    try { await live.identify(saved) } catch { /* A nickname failure never blocks entry. */ }
  }
}
