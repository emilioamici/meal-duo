import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
let hash = ''
const replaced: string[] = []
beforeEach(() => {
  store.clear(); hash = ''; replaced.length = 0
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
  vi.stubGlobal('window', { location: { origin: 'https://utente.github.io', get hash() { return hash }, pathname: '/meal-duo/', search: '' } })
  vi.stubGlobal('history', { replaceState: (_s: unknown, _t: string, url: string) => { replaced.push(url); hash = '' } })
})

describe('link d\'invito', () => {
  it('inviteLink punta all\'app con #join=<id>', async () => {
    const { inviteLink } = await import('./invite')
    expect(inviteLink('FILEID12345')).toMatch(/^https:\/\/utente\.github\.io.*#join=FILEID12345$/)
  })
  it('consumeInviteFromUrl ricorda l\'ID, ripulisce la barra e sopravvive al giro su Google', async () => {
    const { consumeInviteFromUrl, pendingInvite, clearInvite } = await import('./invite')
    hash = '#join=FILEID12345'
    expect(consumeInviteFromUrl()).toBe(true)
    expect(replaced).toEqual(['/meal-duo/'])
    expect(pendingInvite()).toBe('FILEID12345')
    clearInvite()
    expect(pendingInvite()).toBeNull()
  })
  it('ignora indirizzi senza invito e ID non validi', async () => {
    const { consumeInviteFromUrl, pendingInvite } = await import('./invite')
    hash = '#altro'; expect(consumeInviteFromUrl()).toBe(false)
    hash = '#join=corto'; expect(consumeInviteFromUrl()).toBe(true)
    expect(pendingInvite()).toBeNull()
    hash = '#join=<script>'; expect(consumeInviteFromUrl()).toBe(false)
  })
})
