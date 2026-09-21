// Physical attention for an evacuation alert. Vibration only: browsers block
// audio until the user has tapped the page, so a "siren" would silently fail
// exactly when nobody has touched the app yet. Chrome applies the same gate
// to vibration (it ignores a call before any tap), and iPhones have no web
// vibration at all -- so this helps when an alert arrives while the app is in
// use, and the screen itself remains the alert otherwise.

const EVACUATION_PATTERN = [500, 250, 500, 250, 1000]

export function vibrateEmergency(): void {
  try {
    navigator.vibrate?.(EVACUATION_PATTERN)
  } catch {
    // Unsupported or blocked: nothing to do, the takeover is on screen.
  }
}

export function stopVibration(): void {
  try {
    navigator.vibrate?.(0)
  } catch {
    // See vibrateEmergency.
  }
}
