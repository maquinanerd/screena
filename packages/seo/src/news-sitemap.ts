/**
 * news-sitemap.ts — Google News sitemap. PURO.
 *
 * NAO e o sitemap normal com outro nome. O Google News tem regras proprias, e
 * cada uma delas existe por um motivo que o sitemap comum nao cobre:
 *
 *  - **Janela de 48 horas.** O Google News so aceita materia publicada nas
 *    ultimas 48h. Incluir materia antiga nao "ajuda um pouco": faz o arquivo
 *    inteiro ser tratado como de baixa qualidade.
 *  - **Teto de 1.000 URLs.** Acima disso o arquivo e recusado — nao truncado.
 *  - **Data de PUBLICACAO, nunca de modificacao.** `lastmod` do sitemap comum
 *    responde "quando mudou"; aqui a pergunta e "quando saiu", e trocar as duas
 *    faria uma correcao de virgula parecer materia nova.
 *
 * PURO: o instante de referencia e INJETADO. Ler o relogio aqui tornaria o
 * teste da janela de 48h impossivel de escrever sem congelar tempo global.
 */

import { escapeXml, SITEMAP_CONTENT_TYPE } from './sitemap-xml.js'

export { SITEMAP_CONTENT_TYPE }

/** Teto do protocolo. Arquivo acima disso e RECUSADO, nao truncado. */
export const NEWS_SITEMAP_MAX_URLS = 1_000

/** Janela de elegibilidade do Google News, em milissegundos. */
export const NEWS_SITEMAP_WINDOW_MS = 48 * 60 * 60 * 1_000

export interface NewsSitemapCandidate {
  /** URL absoluta canonica, com barra final. */
  readonly loc: string
  readonly title: string
  /** Instante de PUBLICACAO em ISO-8601. */
  readonly publishedAtIso: string
  readonly language: string
  /** Decisao de indexabilidade ja calculada. */
  readonly decision: string
}

export interface NewsSitemapEntry {
  readonly loc: string
  readonly title: string
  readonly publishedAtIso: string
  readonly language: string
}

export interface NewsSitemapPlan {
  readonly entries: readonly NewsSitemapEntry[]
  /** Quantas foram descartadas, por motivo. Vai para log, nunca some em silencio. */
  readonly dropped: {
    readonly notIndexable: number
    readonly outsideWindow: number
    readonly invalidDate: number
    readonly overLimit: number
  }
}

/**
 * Quais materias entram no Google News sitemap AGORA.
 *
 * Ordena da mais recente para a mais antiga antes de aplicar o teto: se o corte
 * for necessario, o que se perde e o mais velho — que ja esta perto de sair da
 * janela de qualquer forma.
 */
export function planNewsSitemap(
  candidates: readonly NewsSitemapCandidate[],
  nowIso: string,
): NewsSitemapPlan {
  const now = Date.parse(nowIso)
  if (!Number.isFinite(now)) {
    // Sem instante confiavel nao ha como decidir a janela. Devolver vazio e
    // fail-closed: um sitemap de noticias vazio e valido; um com materia fora
    // da janela desqualifica o arquivo inteiro.
    return {
      entries: [],
      dropped: {
        notIndexable: 0,
        outsideWindow: 0,
        invalidDate: candidates.length,
        overLimit: 0,
      },
    }
  }

  let notIndexable = 0
  let outsideWindow = 0
  let invalidDate = 0

  const eligible: (NewsSitemapEntry & { readonly at: number })[] = []

  for (const candidate of candidates) {
    if (candidate.decision !== 'index') {
      notIndexable += 1
      continue
    }
    const at = Date.parse(candidate.publishedAtIso)
    if (!Number.isFinite(at)) {
      invalidDate += 1
      continue
    }
    // Materia AGENDADA (publicacao no futuro) nao entra: anunciar ao buscador
    // uma URL que ainda nao deve ser publica e o mesmo vazamento que o gate de
    // publicacao existe para impedir.
    if (at > now) {
      outsideWindow += 1
      continue
    }
    if (now - at > NEWS_SITEMAP_WINDOW_MS) {
      outsideWindow += 1
      continue
    }
    eligible.push({
      loc: candidate.loc,
      title: candidate.title,
      publishedAtIso: candidate.publishedAtIso,
      language: candidate.language,
      at,
    })
  }

  eligible.sort((a, b) => b.at - a.at)

  const kept = eligible.slice(0, NEWS_SITEMAP_MAX_URLS)
  const overLimit = eligible.length - kept.length

  return {
    entries: kept.map(({ at: _at, ...entry }) => entry),
    dropped: { notIndexable, outsideWindow, invalidDate, overLimit },
  }
}

/**
 * Serializa o plano em XML do Google News.
 *
 * O namespace `news` e obrigatorio: sem ele o arquivo e lido como sitemap comum
 * e as tags `news:*` sao ignoradas em silencio — o pior desfecho, porque o
 * arquivo continua "valido".
 */
export function renderNewsSitemap(
  entries: readonly NewsSitemapEntry[],
  publicationName: string,
): string {
  const body = entries
    .map((entry) => {
      const language = entry.language.split('-')[0] ?? entry.language
      return [
        '  <url>',
        `    <loc>${escapeXml(entry.loc)}</loc>`,
        '    <news:news>',
        '      <news:publication>',
        `        <news:name>${escapeXml(publicationName)}</news:name>`,
        // O Google News espera o codigo CURTO do idioma (`pt`), nao o BCP-47
        // completo (`pt-BR`) — a unica excecao do protocolo sao zh-cn/zh-tw.
        `        <news:language>${escapeXml(language)}</news:language>`,
        '      </news:publication>',
        `      <news:publication_date>${escapeXml(entry.publishedAtIso)}</news:publication_date>`,
        `      <news:title>${escapeXml(entry.title)}</news:title>`,
        '    </news:news>',
        '  </url>',
      ].join('\n')
    })
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    body,
    '</urlset>',
    '',
  ]
    .filter((line, index) => !(index === 3 && line === ''))
    .join('\n')
}
