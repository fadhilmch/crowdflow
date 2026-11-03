import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

/** Files that intentionally use fixed colours. Keep each entry justified. */
const COLOUR_EXCEPTIONS: Record<string, string> = {
  'components/JoinPanel.vue': 'QR code needs fixed high-contrast black on white to scan',
  'components/ParticipantAvatar.vue': 'white initials on generated gradient',
}

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : vueFiles(p)
    return p.endsWith('.vue') ? [p] : []
  })
}

describe('design tokens', () => {
  it('keeps hex colours out of components except documented exceptions', () => {
    const offenders: string[] = []
    for (const file of vueFiles(SRC)) {
      const rel = relative(SRC, file)
      if (rel in COLOUR_EXCEPTIONS) continue
      const hits = readFileSync(file, 'utf8').match(/(?<![&\w])#[0-9a-fA-F]{3,8}\b(?!["'][^>]*href)/g)
      if (hits) offenders.push(`${rel}: ${hits.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})
