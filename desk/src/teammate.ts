import { useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from './lib'

/* The teammate's identity.
   On Lemma a pod IS the teammate: the pod's name is the teammate's name and the pod's
   icon is its face, and that is what Lemma's own screens show. So the app reads both
   from the pod instead of keeping a name of its own, and renaming here renames the pod.
   One teammate, one name, one face, wherever somebody meets it. */

export const DEFAULT_TEAMMATE = 'Otto'

interface PodFace { name?: string | null; icon_url?: string | null }
type Pods = { get: (id: string) => Promise<PodFace>; update: (id: string, p: PodFace) => Promise<PodFace> }
const pods = () => client.pods as unknown as Pods
const podId = () => String((client as unknown as { podId?: string; _podId?: string }).podId
  ?? (client as unknown as { _podId?: string })._podId ?? '')

let current = DEFAULT_TEAMMATE
/** The name, for wording built outside a hook. The App holds useTeammate at its root, so
 *  every screen re-renders with the pod's real name as soon as it is known. */
export const tm = () => current

export function useTeammateFace(): { name: string; icon: string | null } {
  const q = useQuery({
    queryKey: ['teammate'], staleTime: 5 * 60_000,
    queryFn: () => pods().get(podId()).catch(() => ({} as PodFace)),
  })
  current = (q.data?.name || '').trim() || DEFAULT_TEAMMATE
  return { name: current, icon: q.data?.icon_url || null }
}

export const useTeammate = () => useTeammateFace().name

/** Rename the teammate everywhere. Only somebody allowed to edit the pod can; for
 *  anyone else this fails quietly and the name stays as it was. */
export function useRenameTeammate() {
  const qc = useQueryClient()
  return async (name: string) => {
    const v = name.trim()
    if (!v) return
    try { await pods().update(podId(), { name: v }); await qc.invalidateQueries({ queryKey: ['teammate'] }) } catch { /* not theirs to rename */ }
  }
}
