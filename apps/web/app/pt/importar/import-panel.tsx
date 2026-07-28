'use client'

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { authFetch } from '../../../src/lib/csrf-client'
import {
  IcAlert,
  IcCheck2,
  IcClock,
  IcDownload,
  IcEye,
  IcLayers,
  IcLock,
  IcUpload,
} from '../../_components/canon-icons'

/**
 * Painel de IMPORTAÇÃO (C8) — tela 14 do canônico, estrutura EXATA:
 * garantias (grid 2×2) → chips de origem → card de instruções (passos +
 * "o que será importado") → dropzone REAL com os estados canônicos
 * (vazio/arrastando/validando/concluído/erro) → análise REAL da prévia
 * (barra de progresso + tiles de estatística) → exportar.
 *
 * Fluxo obrigatório preservado (nunca "envia e escreve tudo"):
 *   escolher arquivo -> PREVIEW (nenhuma escrita) -> confirmar -> aplicar.
 *
 * Origens REAIS da borda: CSV canônico da Cinerie e CSV do Letterboxd.
 * Origens do protótipo sem backend (TV Time, IMDb, Trakt, JSON) são omitidas —
 * nunca chip morto (DIVERGENCIAS registra). O arquivo vai como base64 no JSON
 * (borda JSON-only, CSRF por double-submit); compactados são recusados pela
 * borda e a tela reflete a mensagem.
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

interface SourceInfo {
  value: 'cinerie_csv' | 'letterboxd_csv'
  chip: string
  title: string
  steps: string[]
  fileType: string
  imports: string[]
  limits: string
}

const FONTES: SourceInfo[] = [
  {
    value: 'cinerie_csv',
    chip: 'Arquivo CSV',
    title: 'Importação via CSV da Cinerie',
    steps: [
      'Use o modelo CSV da Cinerie ou uma exportação compatível.',
      'Mantenha as colunas de título, tipo, data e nota.',
      'Validamos e mostramos uma prévia antes de aplicar qualquer alteração.',
    ],
    fileType: '.csv',
    imports: ['Histórico e watchlist', 'Avaliações compatíveis', 'Prévia antes de confirmar'],
    limits: 'Arquivos compactados (.zip) não são aceitos — extraia o CSV e envie.',
  },
  {
    value: 'letterboxd_csv',
    chip: 'Letterboxd',
    title: 'Traga seu diário do Letterboxd',
    steps: [
      'Em Settings → Import & Export, escolha Export your data.',
      'Extraia o .zip recebido por e-mail.',
      'Envie os .csv de watched, ratings ou watchlist aqui.',
    ],
    fileType: '.csv (extraído do .zip)',
    imports: ['Filmes vistos', 'Avaliações', 'Watchlist'],
    limits: 'Apenas filmes — o Letterboxd não cataloga séries.',
  },
]

const ESTADOS_ALVO = [
  { value: 'watched', rotulo: 'Assistidos' },
  { value: 'watchlist', rotulo: 'Quero assistir' },
] as const

const GARANTIAS: { icon: ReactNode; color: string; title: string; text: string }[] = [
  {
    icon: <IcCheck2 size={16} />,
    color: 'var(--c-state-success)',
    title: 'O que será importado',
    text: 'Histórico, watchlist e avaliações compatíveis com a origem escolhida.',
  },
  {
    icon: <IcLock size={16} />,
    color: 'var(--c-text-primary)',
    title: 'Nada muda sem confirmação',
    text: 'Mostramos uma prévia; você aprova antes de qualquer alteração no perfil.',
  },
  {
    icon: <IcLayers size={16} />,
    color: '#b4884a',
    title: 'Duplicados são detectados',
    text: 'Itens já existentes não viram registros repetidos — a aplicação é idempotente.',
  },
  {
    icon: <IcEye size={16} />,
    color: 'var(--c-text-secondary)',
    title: 'Seus dados ficam na Cinerie',
    text: 'O processamento acontece na sua conta e nada é publicado automaticamente.',
  },
]

export function ImportPanel(): React.ReactElement {
  const [fonte, setFonte] = useState<SourceInfo>(() => {
    const primeira = FONTES[0]
    if (primeira === undefined) throw new Error('FONTES não pode ser vazio')
    return primeira
  })
  const [alvo, setAlvo] = useState<string>('watched')
  const [etapa, setEtapa] = useState<Etapa>('escolher')
  const [arrastando, setArrastando] = useState(false)
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [job, setJob] = useState<JobRef | null>(null)
  const [resumo, setResumo] = useState<PreviewSummary | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  /** Lê o arquivo como base64 sem sair do navegador. */
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

  async function preVisualizar(file: File): Promise<void> {
    setAviso(null)
    setNomeArquivo(file.name)
    setEtapa('enviando')
    try {
      const contentBase64 = await fileToBase64(file)
      const r = await authFetch('/api/me/imports', {
        method: 'POST',
        body: JSON.stringify({
          source: fonte.value,
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
        setAviso(
          (corpo as { message?: string } | null)?.message ?? 'Não foi possível processar o arquivo.',
        )
        return
      }
      setJob(corpo.job)
      setResumo(corpo.preview)
      setEtapa('preview')
    } catch {
      setEtapa('erro')
      setAviso('Não foi possível ler o arquivo.')
    }
  }

  async function aplicar(): Promise<void> {
    if (job === null) return
    setEtapa('aplicando')
    setAviso(null)
    const r = await authFetch(`/api/me/imports/${job.id}/apply`, { method: 'POST' })
    if (!r.ok) {
      setEtapa('erro')
      setAviso('Não foi possível aplicar a importação.')
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
    setNomeArquivo(null)
    setAviso('Importação cancelada.')
  }

  async function exportar(): Promise<void> {
    setAviso(null)
    const r = await authFetch('/api/account/export', { method: 'POST' })
    if (!r.ok) {
      setAviso('Não foi possível gerar a exportação agora.')
      return
    }
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cinerie-meus-dados.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const dropClasse =
    etapa === 'enviando'
      ? 'imp-drop imp-drop--validando'
      : etapa === 'erro'
        ? 'imp-drop imp-drop--erro'
        : etapa === 'preview' || etapa === 'aplicado'
          ? 'imp-drop imp-drop--ok'
          : arrastando
            ? 'imp-drop imp-drop--arrastando'
            : 'imp-drop'

  return (
    <div aria-live="polite">
      <div className="imp-facts">
        {GARANTIAS.map((f) => (
          <div className="imp-fact" key={f.title}>
            <span aria-hidden="true" className="imp-fact__icon" style={{ color: f.color }}>
              {f.icon}
            </span>
            <div>
              <div className="imp-fact__title">{f.title}</div>
              <div className="imp-fact__text">{f.text}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="set-section-head" style={{ margin: '0 0 6px' }}>
        <div className="set-section-head__title">
          <span aria-hidden="true" className="set-section-head__bar" />
          <h2>
            <strong>Importar</strong> <span>de outra plataforma</span>
          </h2>
        </div>
      </div>
      <p className="imp-hint">Escolha a origem para ver o passo a passo.</p>

      <div aria-label="Origem da importação" className="imp-chips" role="tablist">
        {FONTES.map((f) => (
          <button
            aria-selected={fonte.value === f.value}
            className="imp-chip"
            key={f.value}
            onClick={() => setFonte(f)}
            role="tab"
            type="button"
          >
            {f.chip}
          </button>
        ))}
      </div>

      <div className="imp-info">
        <div className="imp-info__steps">
          <div className="imp-info__title">{fonte.title}</div>
          <div className="imp-info__list">
            {fonte.steps.map((text, index) => (
              <div className="imp-step" key={text}>
                <span aria-hidden="true" className="imp-step__n">
                  {index + 1}
                </span>
                <span className="imp-step__text">{text}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="imp-info__side">
          <div className="imp-info__label">O que será importado</div>
          <div className="imp-info__imports">
            {fonte.imports.map((item) => (
              <div className="imp-import" key={item}>
                <IcCheck2 size={15} />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="imp-info__foot">
            <div className="imp-info__file">
              <strong>Arquivo aceito:</strong> {fonte.fileType}
            </div>
            <div className="imp-info__limits">
              <IcAlert size={14} />
              <span>{fonte.limits}</span>
            </div>
          </div>
        </div>
      </div>

      <fieldset className="imp-target">
        <legend>Marcar como</legend>
        <div className="imp-target__seg">
          {ESTADOS_ALVO.map((s) => (
            <label className={alvo === s.value ? 'imp-seg imp-seg--active' : 'imp-seg'} key={s.value}>
              <input
                checked={alvo === s.value}
                name="alvo"
                onChange={() => setAlvo(s.value)}
                type="radio"
                value={s.value}
              />
              {s.rotulo}
            </label>
          ))}
        </div>
      </fieldset>

      <div
        className={dropClasse}
        onDragLeave={() => setArrastando(false)}
        onDragOver={(event) => {
          event.preventDefault()
          setArrastando(true)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setArrastando(false)
          const file = event.dataTransfer.files[0]
          if (file !== undefined && etapa !== 'enviando' && etapa !== 'aplicando') {
            void preVisualizar(file)
          }
        }}
      >
        <label className="imp-drop__label" htmlFor="imp-arquivo">
          <span aria-hidden="true" className="imp-drop__icon">
            {etapa === 'enviando' ? (
              <IcClock size={22} />
            ) : etapa === 'erro' ? (
              <IcAlert size={22} />
            ) : etapa === 'preview' || etapa === 'aplicado' ? (
              <IcCheck2 size={22} />
            ) : (
              <IcUpload size={22} />
            )}
          </span>
          <span className="imp-drop__title">
            {etapa === 'enviando'
              ? 'Verificando o arquivo…'
              : etapa === 'erro'
                ? 'Falha ao ler o arquivo'
                : etapa === 'preview' || etapa === 'aplicado'
                  ? (nomeArquivo ?? 'Arquivo recebido')
                  : arrastando
                    ? 'Solte para enviar'
                    : 'Arraste seu arquivo aqui ou clique para enviar'}
          </span>
          <span className="imp-drop__sub">
            Validamos e mostramos uma prévia antes de aplicar qualquer mudança
          </span>
        </label>
        <input
          accept=".csv,text/csv"
          className="visually-hidden"
          disabled={etapa === 'enviando' || etapa === 'aplicando'}
          id="imp-arquivo"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) void preVisualizar(file)
            event.target.value = ''
          }}
          ref={inputRef}
          type="file"
        />
      </div>

      {etapa === 'preview' && resumo !== null ? (
        <section aria-labelledby="imp-analise-titulo">
          <div className="set-section-head">
            <div className="set-section-head__title">
              <span aria-hidden="true" className="set-section-head__bar" />
              <h2 id="imp-analise-titulo">
                <strong>Análise</strong> <span>do arquivo</span>
              </h2>
            </div>
          </div>
          <div className="imp-analysis">
            <div className="imp-analysis__head">
              <span className="imp-analysis__title">Linhas válidas no arquivo</span>
              <span className="imp-analysis__count">
                <strong>
                  {resumo.validRows} / {resumo.totalRows}
                </strong>
              </span>
            </div>
            <div aria-hidden="true" className="imp-progress">
              <div
                className="imp-progress__fill"
                style={{
                  width: `${resumo.totalRows > 0 ? Math.round((resumo.validRows / resumo.totalRows) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="imp-stats">
              <Stat accent="var(--c-accent-movie)" label="Linhas no arquivo" value={resumo.totalRows} />
              <Stat accent="var(--c-accent-series)" label="Válidas" value={resumo.validRows} />
              <Stat
                accent="var(--c-accent-movie)"
                label="Rejeitadas"
                value={resumo.rejectedRows}
                warn={resumo.rejectedRows > 0}
              />
              <Stat
                accent="#b4884a"
                label="Duplicadas no arquivo"
                value={resumo.duplicateRows}
                warn={resumo.duplicateRows > 0}
              />
              <Stat
                accent="#b4884a"
                label="Ambíguas ou não encontradas"
                value={resumo.ambiguous + resumo.notFound}
                warn={resumo.ambiguous + resumo.notFound > 0}
              />
              <Stat accent="var(--c-text-primary)" label="Serão aplicadas" value={resumo.applicable} />
            </div>
            <p className="imp-analysis__note">
              Nenhum dado foi gravado ainda. Itens ambíguos ou não encontrados não são aplicados
              automaticamente — ficam no relatório para você resolver.
            </p>
            <div className="imp-analysis__actions">
              <button className="imp-primary" onClick={() => void aplicar()} type="button">
                Aplicar {resumo.applicable} item(ns)
              </button>
              <button className="imp-secondary" onClick={() => void cancelar()} type="button">
                Cancelar
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {etapa === 'aplicando' ? <p role="status">Aplicando…</p> : null}
      {etapa === 'aplicado' ? (
        <p className="alert alert--success" role="status">
          Importação concluída. Veja em <a href="/pt/minha-lista/">minha biblioteca</a>.
        </p>
      ) : null}
      {aviso !== null ? (
        <p className={etapa === 'erro' ? 'alert alert--error' : 'alert alert--info'} role={etapa === 'erro' ? 'alert' : 'status'}>
          {aviso}
        </p>
      ) : null}

      <div className="set-section-head">
        <div className="set-section-head__title">
          <span aria-hidden="true" className="set-section-head__bar" />
          <h2>
            <strong>Exportar</strong> <span>meus dados</span>
          </h2>
        </div>
      </div>
      <div className="imp-export">
        <div className="imp-export__head">
          <span aria-hidden="true" className="imp-export__icon">
            <IcDownload size={16} />
          </span>
          <h3>Exportar dados</h3>
        </div>
        <p>
          Gera um único arquivo com seu histórico, listas e avaliações. A exportação contém apenas
          seus próprios dados e nunca inclui senhas ou tokens.
        </p>
        <button className="imp-primary" onClick={() => void exportar()} type="button">
          <IcDownload size={16} /> Exportar agora
        </button>
      </div>
      <div className="set-bottom-space" />
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
  warn,
}: {
  label: string
  value: number
  accent: string
  warn?: boolean
}): ReactNode {
  return (
    <div className="imp-stat">
      <div className="imp-stat__row">
        <span aria-hidden="true" className="imp-stat__dot" style={{ background: accent }} />
        <span className="imp-stat__value" style={warn === true ? { color: accent } : undefined}>
          {value}
        </span>
      </div>
      <div className="imp-stat__label">{label}</div>
    </div>
  )
}
