/**
 * Membro che sta usando questo dispositivo: le mutazioni di dbOps lo scrivono in `by`.
 * Impostato dallo store appena l'account Google è associato a un membro.
 */
let actor: string | undefined
export const setActor = (id: string | undefined): void => { actor = id }
export const getActor = (): string | undefined => actor
