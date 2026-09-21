// First screen on every app open -- a bold, high-contrast intro before the
// resident/simulator chrome, same intent as a native app's launch screen.
// Deliberately inverted (dark on light-everything-else) as a one-time hero
// moment, not a theme change to the rest of the app.
export function SplashScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink p-8 text-center">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="mb-6">
        <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="1.8" />
        <g stroke="white" strokeWidth="1.8" strokeLinecap="round">
          <line x1="12" y1="1.5" x2="12" y2="4.5" />
          <line x1="12" y1="19.5" x2="12" y2="22.5" />
          <line x1="1.5" y1="12" x2="4.5" y2="12" />
          <line x1="19.5" y1="12" x2="22.5" y2="12" />
          <line x1="4.4" y1="4.4" x2="6.5" y2="6.5" />
          <line x1="17.5" y1="17.5" x2="19.6" y2="19.6" />
          <line x1="4.4" y1="19.6" x2="6.5" y2="17.5" />
          <line x1="17.5" y1="6.5" x2="19.6" y2="4.4" />
        </g>
      </svg>

      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/60">Barangay</p>
      <h1 className="font-display text-5xl font-bold uppercase leading-tight text-white">Ligtas</h1>

      <p className="mt-6 max-w-xs text-sm leading-relaxed text-white/80">
        Ang sistemang ito ay awtomatikong magbibigay-alam sa inyo ng ruta ng paglikas at lokasyon sa araw ng baha o
        bagyo.
      </p>

      <button
        onClick={onContinue}
        className="mt-10 w-full max-w-xs rounded-lg bg-accent py-3 text-sm font-semibold text-ink hover:brightness-95"
      >
        Continue
      </button>
    </div>
  )
}
