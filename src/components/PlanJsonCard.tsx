import { useState } from 'react'
import { Download, FileJson, FileUp, Upload } from 'lucide-react'
import { ImportSheet } from './ImportSheet'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { useActiveMember } from '../state/hooks'
import { exportPlan, planTemplate } from '../services/planIO'
import { copyText, downloadJson } from '../lib/files'
import { t } from '../i18n'

/** Importa / esporta il piano settimanale del membro selezionato in JSON (con tracciato vuoto e di esempio). */
export function PlanJsonCard({ bare = false }: { bare?: boolean }) {
  const { db } = useStore()
  const { showToast } = useUi()
  const member = useActiveMember()
  const [importOpen, setImportOpen] = useState(false)
  const fileName = `meal-duo-${member.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`
  const body = (
    <>
      <p className="mt-1 text-sm text-muted">{t('Esporta il piano di {name} o un tracciato da compilare altrove (anche con un assistente AI), poi reimportalo: i nomi vengono associati al catalogo della casa.', { name: member.name })}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="glass-btn btn-primary" onClick={() => setImportOpen(true)}><Upload size={16} />{t('Importa piano')}</button>
        <button className="glass-btn" onClick={() => { downloadJson(fileName, exportPlan(db, member.id)); showToast(t('Piano esportato')) }}><Download size={16} />{t('Esporta piano')}</button>
        <button className="glass-btn" onClick={() => downloadJson('meal-duo-esempio.json', planTemplate('example'))}><FileUp size={16} />{t('Tracciato di esempio')}</button>
        <button className="glass-btn" onClick={() => downloadJson('meal-duo-tracciato-vuoto.json', planTemplate('empty'))}><FileUp size={16} />{t('Tracciato vuoto')}</button>
      </div>
      <button className="mt-3 text-sm font-semibold text-brand" onClick={async () => showToast((await copyText(JSON.stringify(exportPlan(db, member.id), null, 2))) ? t('JSON copiato negli appunti') : t('Copia non riuscita'))}>{t('Copia il JSON negli appunti')}</button>
      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} initialMemberId={member.id} />
    </>
  )
  if (bare) return <div>{body}</div>
  return (
    <section className="card mt-3 p-4">
      <div className="flex items-center gap-2"><FileJson size={20} className="text-brand" /><h2 className="font-bold">{t('Piano in JSON')}</h2></div>
      {body}
    </section>
  )
}
