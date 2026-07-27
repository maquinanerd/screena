'use client'

import { useState } from 'react'

import { authFetch } from '../../../src/lib/csrf-client'

/**
 * Painel de IMPORTACAO (C8).
 *
 * Implementa o fluxo obrigatorio, nunca "envia e escreve tudo":
 *   escolher arquivo -> PREVIEW (nenhuma escrita) -> confirmar -> aplicar.
 *
 * O arquivo e enviado como base64 dentro do JSON (a borda e JSON-only, o que
 * barra o CSRF por formulario HTML). Formatos aceitos: CSV do Letterboxd (ja
 * extraido do .zip) e CSV canonico da Cinerie. Compactados sao recusados pela
 * borda — a tela apenas reflete a mensagem.
 */

interface PreviewSummary {
  totalRows: number
  validRows: number
  rejectedRows: number
  duplicateRows: number
  exact: number
  ambiguous: number
  notFound: number
  applicable: number
  conflicts: number
}

interface JobRef {
  id: string
  status: string
}

type Etapa = 'escolher' | 'enviando' | 'preview' | 'aplicando' | 'aplicado' | 'erro'

const FONTES = [
  { value: 'cinerie_csv', rotulo: 'CSV da Cinerie (formato canonico)' },
  { value: 'letterboxd_csv', rotulo: 'CSV do Letterboxd (extraido do .zip)' },
] as const

const ESTADOS_ALVO = [
  { value: 'watched', rotulo: 'Assistidos' },
  { value: 'watchlist', rotulo: 'Quero assistir' },
] as const

export function ImportPanel(): React.ReactElement {
  const [fonte, setFonte] = useState<string>('cinerie_csv')
  const [alvo, setAlvo] = useState<string>('watched')
  const [etapa, setEtapa] = useState<Etapa>('escolher')
  const [job, setJob] = useState<JobRef | null>(null)
  const [resumo, setResumo] = useState<PreviewSummary | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  /** Le o arquivo como base64 sem sair do navegador. */
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('falha ao ler o arquivo'))
      reader.onload = () => {
        const result = String(reader.result)
        // data:...;base64,<conteudo>
        const virgula = result.indexOf(',')
        resolve(virgula >= 0 ? result.slice(virgula + 1) : result)
      }
      reader.readAsDataURL(file)
    })
  }

  async function enviar(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setAviso(null)
    const form = event.currentTarget
    const input = form.elements.namedItem('arquivo') as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) {
      setAviso('Escolha um arquivo CSV.')
      return
    }
    setEtapa('enviando')
    try {
      const contentBase64 = await fileToBase64(file)
      const r = await authFetch('/api/me/imports', {
        method: 'POST',
        body: JSON.stringify({
          source: fonte,
          targetState: alvo,
          fileName: file.name,
          contentBase64,
        }),
      })
      const corpo = (await r.json().catch(() => null)) as
        | { ok: true; job: JobRef; preview: PreviewSummary }
        | { ok: false; message?: string }
        | null
      if (!r.ok || corpo === null || corpo.ok !== true) {
        setEtapa('erro')
        setAviso((corpo as { message?: string } | null)?.message ?? 'Nao foi possivel processar o arquivo.')
        return
      }
      setJob(corpo.job)
      setResumo(corpo.preview)
      setEtapa('preview')
    } catch {
      setEtapa('erro')
      setAviso('Nao foi possivel ler o arquivo.')
    }
  }

  async function aplicar(): Promise<void> {
    if (job === null) return
    setEtapa('aplicando')
    setAviso(null)
    const r = await authFetch(`/api/me/imports/${job.id}/apply`, { method: 'POST' })
    if (!r.ok) {
      setEtapa('erro')
      setAviso('Nao foi possivel aplicar a importacao.')
      return
    }
    const dados = (await r.json()) as { appliedCount: number }
    setAviso(`${dados.appliedCount} item(ns) aplicado(s).`)
    setEtapa('aplicado')
  }

  async function cancelar(): Promise<void> {
    if (job === null) return
    await authFetch(`/api/me/imports/${job.id}/cancel`, { method: 'POST' })
    setEtapa('escolher')
    setJob(null)
    setResumo(null)
    setAviso('Importacao cancelada.')
  }

  return (
    <div aria-live="polite">
      {etapa === 'escolher' || etapa === 'enviando' || etapa === 'erro' ? (
        <form onSubmit={enviar}>
          <fieldset>
            <legend>Origem</legend>
            {FONTES.map((f) => (
              <label key={f.value}>
                <input
                  type="radio"
                  name="fonte"
                  value={f.value}
                  checked={fonte === f.value}
                  onChange={() => setFonte(f.value)}
                />
                {f.rotulo}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Marcar como</legend>
            {ESTADOS_ALVO.map((s) => (
              <label key={s.value}>
                <input
                  type="radio"
                  name="alvo"
                  value={s.value}
                  checked={alvo === s.value}
                  onChange={() => setAlvo(s.value)}
                />
                {s.rotulo}
              </label>
            ))}
          </fieldset>

          <label htmlFor="arquivo">Arquivo CSV</label>
          <input id="arquivo" name="arquivo" type="file" accept=".csv,text/csv" required />
          <p>
            Envie o arquivo <strong>CSV</strong>. Arquivos compactados (.zip) nao sao aceitos —
            extraia o CSV e envie.
          </p>

          <button type="submit" disabled={etapa === 'enviando'}>
            {etapa === 'enviando' ? 'Processando...' : 'Pre-visualizar'}
          </button>
        </form>
      ) : null}

      {etapa === 'preview' && resumo !== null ? (
        <section aria-labelledby="preview-titulo">
          <h2 id="preview-titulo">Pre-visualizacao</h2>
          <p>Nenhum dado foi gravado ainda. Confira antes de aplicar.</p>
          <ul>
            <li>{resumo.totalRows} linha(s) no arquivo</li>
            <li>{resumo.validRows} valida(s), {resumo.rejectedRows} rejeitada(s)</li>
            <li>{resumo.duplicateRows} duplicada(s) no arquivo</li>
            <li>{resumo.exact} correspondencia(s) exata(s)</li>
            <li>{resumo.ambiguous} ambigua(s), {resumo.notFound} nao encontrada(s)</li>
            <li>{resumo.conflicts} conflito(s)</li>
            <li>
              <strong>{resumo.applicable}</strong> item(ns) sera(ao) aplicado(s)
            </li>
          </ul>
          <p>
            Itens ambiguos ou nao encontrados nao sao aplicados automaticamente — ficam no
            relatorio para voce resolver.
          </p>
          <button type="button" onClick={() => void aplicar()}>
            Aplicar {resumo.applicable} item(ns)
          </button>{' '}
          <button type="button" onClick={() => void cancelar()}>
            Cancelar
          </button>
        </section>
      ) : null}

      {etapa === 'aplicando' ? <p role="status">Aplicando...</p> : null}
      {etapa === 'aplicado' ? (
        <p role="status">
          Importacao concluida. Veja em <a href="/pt/minha-lista">minha biblioteca</a>.
        </p>
      ) : null}
      {aviso !== null ? (
        <p role={etapa === 'erro' ? 'alert' : 'status'}>{aviso}</p>
      ) : null}
    </div>
  )
}
