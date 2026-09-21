import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Guards the theme's readability. It reads the real --color-* values out of
// src/index.css, so changing a token in a way that hurts contrast fails here
// instead of being noticed by a resident squinting at a phone.

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const css = readFileSync(join(SRC, 'index.css'), 'utf8')

type Rgb = [number, number, number]

/** OKLCH -> linear-light sRGB (Bjorn Ottosson's matrices), clamped to the gamut. */
function oklchToLinear(l: number, c: number, hDeg: number): Rgb {
  const a = c * Math.cos((hDeg * Math.PI) / 180)
  const b = c * Math.sin((hDeg * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb: Rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  return rgb.map((v) => Math.min(1, Math.max(0, v))) as Rgb
}

function tokens(): Record<string, Rgb> {
  const out: Record<string, Rgb> = { white: [1, 1, 1] }
  for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/g)) {
    out[m[1]] = oklchToLinear(Number(m[2]) / 100, Number(m[3]), Number(m[4]))
  }
  return out
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function ratio(colors: Record<string, Rgb>, fg: string, bg: string): number {
  expect(colors[fg], `token ${fg} not found in index.css`).toBeDefined()
  expect(colors[bg], `token ${bg} not found in index.css`).toBeDefined()
  const a = luminance(colors[fg])
  const b = luminance(colors[bg])
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const colors = tokens()

// Every text / background pair the UI puts together, at normal text size.
const TEXT_PAIRS: [string, string[]][] = [
  ['ink', ['bg', 'surface', 'bg-alt', 'accent-bg', 'danger-bg', 'info-bg', 'success-bg', 'accent']],
  ['ink-2', ['bg', 'surface', 'bg-alt', 'accent-bg', 'danger-bg', 'info-bg', 'success-bg']],
  ['ink-3', ['bg', 'surface', 'bg-alt', 'accent-bg', 'danger-bg', 'info-bg', 'success-bg']],
  ['accent-deep', ['bg', 'surface', 'bg-alt', 'accent-bg']],
  ['info', ['bg', 'surface', 'info-bg']],
  ['success', ['bg', 'surface', 'success-bg']],
  ['danger', ['bg', 'surface', 'danger-bg']],
  ['danger-deep', ['bg', 'surface', 'danger-bg']],
  ['white', ['danger', 'danger-deep', 'info']],
]

describe('theme contrast (WCAG AA, 4.5:1 for normal text)', () => {
  for (const [fg, bgs] of TEXT_PAIRS) {
    for (const bg of bgs) {
      it(`${fg} on ${bg}`, () => {
        expect(ratio(colors, fg, bg)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

describe('non-text contrast (3:1)', () => {
  it('a form field border (ink-3) stands out from the field and the page', () => {
    expect(ratio(colors, 'ink-3', 'bg-alt')).toBeGreaterThanOrEqual(3)
    expect(ratio(colors, 'ink-3', 'bg')).toBeGreaterThanOrEqual(3)
  })
})

describe('the marigold accent', () => {
  it('takes dark text: ink on accent is readable, white on accent is not', () => {
    expect(ratio(colors, 'ink', 'accent')).toBeGreaterThanOrEqual(4.5)
    expect(ratio(colors, 'white', 'accent')).toBeLessThan(4.5)
  })

  it('no component puts white text on the marigold accent fill', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith('.tsx')) {
          readFileSync(path, 'utf8')
            .split('\n')
            .forEach((line, i) => {
              // bg-accent as a fill (not bg-accent-bg / bg-accent-deep / bg-accent/40) together with text-white.
              if (/bg-accent(?![-\w/])/.test(line) && /text-white/.test(line)) offenders.push(`${path}:${i + 1}`)
            })
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })
})
