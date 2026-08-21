/**
 * typecheck-exclusion-claims.test.ts — CABECALHO QUE DIZ "EXCLUIDO DO TYPECHECK"
 * TEM DE ESTAR EXCLUIDO DE VERDADE.
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * Dezenas de arquivos abriam com a frase "EXCLUIDO do typecheck". Era falso.
 * `tsconfig.json` inclui `services/**\/*.ts` e exclui uma lista CURTA e
 * NOMINAL: `persistence/**` de DOIS servicos (ingestion e news-ingestion),
 * `scripts/**`, `bin/**` por servico e dois arquivos avulsos. Nada disso
 * alcancava, por exemplo, `services/entity-writer/src/persistence/**` nem
 * `services/sync/src/scheduler/runtime/**` — os dois grupos afirmavam exclusao
 * estando DENTRO do programa.
 *
 * E ha a segunda metade, mais sutil: `pnpm typecheck` NAO e um `tsc` so. Ele
 * roda `tsconfig.json` e ENCADEIA `tsconfig.runtime.json`. Um arquivo fora do
 * primeiro pode estar dentro do segundo — e quase todo `persistence/**` da
 * ingestao esta, junto com sete `bin/` nomeados um a um. "Excluido do
 * tsconfig.json" nao e "excluido do typecheck", e a diferenca e a unica que
 * importa para quem le o cabecalho.
 *
 * ============================================================================
 * POR QUE UM COMENTARIO ERRADO E UM DEFEITO, E NAO UM DETALHE DE PROSA
 * ============================================================================
 * O repositorio documenta um container que morria no import, antes de qualquer
 * log, por um import de TIPO usado como VALOR — o erro que so aparece em
 * producao e que o `tsc` pega de graca. Um cabecalho afirmando que os tipos nao
 * sao conferidos ali AUTORIZA exatamente esse erro: quem le confia, e a rede que
 * existia deixa de ser usada. A prova de que a rede existe e o proprio
 * compilador — sem `@prisma/client` instalado, o `tsc` da raiz emite diagnostico
 * APONTANDO para esses arquivos, o que so acontece com arquivo dentro do
 * programa.
 *
 * ============================================================================
 * A REGRA, E O QUE ELA MEDE
 * ============================================================================
 * A alegacao e sempre sobre O PROPRIO ARQUIVO. Tres formas, tres exigencias:
 *
 *   "EXCLUIDO do typecheck"            (absoluta)  -> fora dos DOIS programas
 *   "fora do typecheck da raiz"        (raiz)      -> fora do `tsconfig.json`
 *   "fora do `tsconfig.runtime.json`"  (runtime)   -> fora do runtime
 *
 * Qualificadores aceitos para "raiz": `raiz`, `principal`, `padrao` — ou nomear
 * `tsconfig.json` diretamente. Nomear `tsconfig.runtime.json` seleciona o outro
 * programa. Sem qualificador, a alegacao vale para os dois.
 *
 * ============================================================================
 * O QUE ESTE GUARD **NAO** FAZ — as tres frestas, declaradas
 * ============================================================================
 * (1) NAO resolve REFERENCIA CRUZADA. Um comentario que fala do typecheck de
 *     OUTRO arquivo e julgado como se falasse de si — e portanto reprova sempre
 *     que o arquivo que o hospeda esta coberto. Isso e deliberado: a convencao
 *     desta leva e que comentario nao afirma a filiacao alheia no typecheck. Era
 *     precisamente esse fato, repetido em vinte modulos puros ("o adapter vive
 *     em persistence/, fora do typecheck"), que apodreceu em bloco quando
 *     `tsconfig.runtime.json` passou a cobrir aquele diretorio. Citar a PORTA e
 *     o ADAPTER continua util; citar o tsconfig deles, nao.
 *     A fresta real: a mesma frase dentro de um arquivo que esta fora dos dois
 *     programas passa em silencio.
 *
 * (2) NAO entende toda a lingua portuguesa. So o vocabulario ABAIXO — a
 *     exclusao tem de governar DIRETAMENTE a palavra do typecheck. "fora do
 *     bundle de render, mas coberto pelo typecheck" nao e alegacao (o "fora"
 *     governa "bundle"), e "o typecheck nao alcanca esse caso" tambem nao (fala
 *     de um CASO, nao de um arquivo). Guard textual so pega a grafia que
 *     conhece; frase nova exige entrada nova aqui.
 *     Esta fresta foi MEDIDA, nao suposta: no controle negativo, "O typecheck
 *     nao cobre este arquivo" — grafia que o repositorio nunca usou — passou
 *     verde. Dai nasceu `INVERTIDA`. A licao fica: mutar o codigo com a MESMA
 *     grafia que o guard procura nao prova nada; o controle negativo util e o
 *     que escreve a alegacao como um humano escreveria.
 *
 * (3) NAO le alegacao entre ASPAS DUPLAS. Citar a frase falsa para refuta-la e o
 *     estilo do repositorio — `runtime/advisory-lock.ts` faz exatamente isso — e
 *     uma citacao nao e uma afirmacao. A fresta: quem quiser esconder uma
 *     alegacao de verdade so precisa de aspas.
 *
 * ============================================================================
 * POR QUE O tsconfig NAO FOI ALARGADO PARA "FAZER OS COMENTARIOS VIRAREM VERDADE"
 * ============================================================================
 * Havia a saida oposta: excluir de fato `entity-writer/**\/persistence/**` e
 * `sync/**\/scheduler/runtime/**`, e os cabecalhos ficariam corretos sozinhos.
 * Nao foi feito, e a razao e uma so: isso APAGARIA a rede que pega o defeito do
 * paragrafo dois. Os arquivos compilam hoje (a CI da raiz e verde com eles
 * dentro); tirar cobertura para acertar a prosa e pagar com seguranca uma divida
 * de redacao.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// A leitura CRUA e deliberada e nao tem substituto: o que este guard mede vive
// DENTRO de um comentario. `readSourceWithoutComments` — a porta padrao —
// devolveria exatamente o vazio que interessa medir.
import { readSourceRaw, REPO_ROOT, stripComments } from '../support/source-text.js'

const MOTIVO_CRU = 'a alegacao auditada vive num COMENTARIO; sem o cru nao ha o que medir'

const TSCONFIG_RAIZ = 'tsconfig.json'
const TSCONFIG_RUNTIME = 'tsconfig.runtime.json'

const RAIZES = ['services', 'packages', 'api-clients', 'tests', 'apps', 'scripts'] as const
const IGNORADOS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage'])

/** Este proprio arquivo: as regexes dele contem os padroes que ele procura. */
const ESTE_GUARD = ['tests', 'governance', 'typecheck-exclusion-claims.test.ts'].join('/')

// ---------------------------------------------------------------------------
// 1. OS DOIS PROGRAMAS, LIDOS DO DISCO
// ---------------------------------------------------------------------------

/** Qual programa de `tsc` uma alegacao esta nomeando. */
export type Programa = 'raiz' | 'runtime' | 'ambos'

interface Globs {
  readonly include: readonly string[]
  readonly exclude: readonly string[]
}

/**
 * Le um tsconfig do disco.
 *
 * Os dois sao JSONC — tem comentario, e comentario longo (a lista de `bin/` do
 * runtime e quase toda prosa explicando por que cada entrypoint entrou).
 * `JSON.parse` direto lanca; por isso o `stripComments(_, 'c-like')` explicito,
 * que e a forma que a porta unica oferece para este caso.
 */
function lerGlobs(arquivo: string): Globs {
  const cru = readSourceRaw(arquivo, MOTIVO_CRU)
  const json = JSON.parse(stripComments(cru, 'c-like')) as {
    include?: string[]
    exclude?: string[]
  }
  return { include: json.include ?? [], exclude: json.exclude ?? [] }
}

/**
 * Reproduz a semantica de `include`/`exclude` do TypeScript.
 *
 * PURA de proposito: recebe os globs, devolve um decisor. Isso permite testa-la
 * com globs inventados, e nao so contra o repositorio — um matcher que so roda
 * sobre a arvore real nao tem como ser provado errado.
 *
 * As duas assimetrias que importam (e que um `minimatch` ingenuo erra):
 *  - em `exclude`, `**` vale `(/.+?)?` e o padrao casa por PREFIXO (`($|/)`),
 *    entao excluir um diretorio exclui tudo abaixo dele;
 *  - em `include`, `*` atravessa ponto (`a.test.ts` casa com `*.ts`) e `**` pula
 *    `node_modules` e diretorios que comecam com ponto.
 */
export function criarDecisor(globs: Globs): (relativo: string) => boolean {
  const incluir = compilar(globs.include, 'include')
  const excluir = compilar(globs.exclude, 'exclude')
  return (relativo) => {
    if (incluir === undefined || !incluir.test(relativo)) return false
    if (excluir !== undefined && excluir.test(relativo)) return false
    return true
  }
}

const BARRA = String.fromCharCode(92)
const RESERVADOS = /[^\w\s/]/g
const PASTAS_DE_PACOTE = '(?!(node_modules|bower_components|jspm_packages)(/|$))'
const ASTERISCO_INCLUDE = '([^./]|(' + BARRA + '.(?!min' + BARRA + '.js$))?)*'

function subPadrao(spec: string, uso: 'include' | 'exclude'): string | undefined {
  const partes = spec.split('/').filter((c) => c.length > 0 && c !== '.')
  const ultima = partes[partes.length - 1] ?? ''
  if (uso !== 'exclude' && ultima === '**') return undefined
  // Componente sem `.`, `*` nem `?` e um DIRETORIO: o TypeScript acrescenta
  // `/**/*` sozinho. Sem isto, `exclude: ["coverage"]` nao excluiria nada.
  if (!/[.*?]/.test(ultima)) partes.push('**', '*')

  let saida = ''
  let escreveu = false
  for (const parte of partes) {
    if (parte === '**') {
      saida += uso === 'exclude' ? '(/.+?)?' : '(/' + PASTAS_DE_PACOTE + '[^/.][^/]*)*?'
      escreveu = true
      continue
    }
    if (escreveu) saida += '/'
    saida += parte.replace(RESERVADOS, (m) => {
      if (m === '*') return uso === 'exclude' ? '[^/]*' : ASTERISCO_INCLUDE
      if (m === '?') return '[^/]'
      return BARRA + m
    })
    escreveu = true
  }
  return saida
}

function compilar(specs: readonly string[], uso: 'include' | 'exclude'): RegExp | undefined {
  const partes = specs.map((s) => subPadrao(s, uso)).filter((p): p is string => p !== undefined)
  if (partes.length === 0) return undefined
  const alternativas = partes.map((p) => '(' + p + ')').join('|')
  return new RegExp('^(' + alternativas + ')' + (uso === 'exclude' ? '($|/)' : '$'))
}

const decisorRaiz = criarDecisor(lerGlobs(TSCONFIG_RAIZ))
const decisorRuntime = criarDecisor(lerGlobs(TSCONFIG_RUNTIME))

interface Cobertura {
  readonly raiz: boolean
  readonly runtime: boolean
}

const coberturaDe = (relativo: string): Cobertura => ({
  raiz: decisorRaiz(relativo),
  runtime: decisorRuntime(relativo),
})

// ---------------------------------------------------------------------------
// 2. O DETECTOR DE ALEGACAO
// ---------------------------------------------------------------------------

/**
 * A palavra de exclusao tem de governar DIRETAMENTE a palavra do typecheck.
 *
 * E a diferenca entre "fora do typecheck" (alegacao) e "fora do bundle de
 * render, mas coberto pelo typecheck" (o oposto de uma alegacao). Uma janela
 * frouxa — "as duas palavras aparecem por perto" — leria as duas igual.
 */
const ALEGACAO =
  /(?:exclu[ií]d\w*|fora)\s+(?:d[aeo]s?\s+)?[`'"(]*(tsconfig\.runtime\.json|tsconfig\.json|tsconfig|typecheck\w*|type-check\w*|tsc)\b[`'")]*(?:\s+(?:d[aeo]\s+)?(raiz|principal|padr[aã]o))?/gi

/** A forma negativa: "nao e typechecked". Nunca traz qualificador. */
const NEGATIVA = /n[aã]o\s+(?:e|é|est[aá])\s+typechecked|n[aã]o\s+typechecked|not\s+typechecked/gi

/**
 * A forma invertida: o typecheck e o SUJEITO ("o typecheck nao cobre X").
 *
 * O objeto tem de ser um ARQUIVO explicito. Sem essa exigencia a regra
 * engoliria "o typecheck nao alcanca esse CASO" — uma frase verdadeira sobre um
 * cenario de runtime, que nada afirma sobre a filiacao do arquivo. Este padrao
 * entrou depois de um controle negativo: escrita assim, a alegacao falsa passou.
 */
const INVERTIDA =
  /(?:typecheck\w*|tsc)\s+n[aã]o\s+(?:cobre|alcan[cç]a|pega|checa|confere|v[eê])\s+(?:est[ea]|ess[ea]|aquel[ea])\s+(?:arquivo|m[oó]dulo|adapter)/gi

export interface Alegacao {
  /** O trecho como escrito, para a mensagem de erro. */
  readonly texto: string
  /** Qual programa a alegacao diz que nao cobre o arquivo. */
  readonly programa: Programa
}

/**
 * Extrai as alegacoes de um texto de comentario. PURA.
 *
 * Trecho entre ASPAS DUPLAS e apagado antes de procurar: citar a frase falsa
 * para refuta-la e o estilo da casa, e citacao nao e afirmacao.
 */
export function acharAlegacoes(comentarios: string): readonly Alegacao[] {
  const semCitacao = comentarios.replace(/"[^"]*"/g, (m) => ' '.repeat(m.length))
  const achadas: Alegacao[] = []

  ALEGACAO.lastIndex = 0
  for (const m of semCitacao.matchAll(ALEGACAO)) {
    const alvo = (m[1] ?? '').toLowerCase()
    const qualificador = (m[2] ?? '').toLowerCase()
    let programa: Programa = 'ambos'
    if (alvo === 'tsconfig.runtime.json') programa = 'runtime'
    else if (alvo.startsWith('tsconfig')) programa = 'raiz'
    else if (qualificador.length > 0) programa = 'raiz'
    achadas.push({ texto: m[0].trim(), programa })
  }

  for (const padrao of [NEGATIVA, INVERTIDA]) {
    padrao.lastIndex = 0
    for (const m of semCitacao.matchAll(padrao)) {
      achadas.push({ texto: m[0].trim(), programa: 'ambos' })
    }
  }

  return achadas
}

/** A alegacao e verdadeira para esta cobertura? */
export function alegacaoConfere(alegacao: Alegacao, cobertura: Cobertura): boolean {
  if (alegacao.programa === 'raiz') return !cobertura.raiz
  if (alegacao.programa === 'runtime') return !cobertura.runtime
  return !cobertura.raiz && !cobertura.runtime
}

// ---------------------------------------------------------------------------
// 3. OS COMENTARIOS, PELA PORTA UNICA
// ---------------------------------------------------------------------------

/**
 * O texto dos COMENTARIOS de um arquivo — o complemento exato do que a porta
 * padrao entrega.
 *
 * `stripComments` troca comentario por ESPACO preservando posicao. Entao onde o
 * cru tem caractere e o limpo tem espaco, aquilo era comentario. Nao ha scanner
 * novo aqui: o mesmo modulo que os outros guards usam decide o que e string e o
 * que e comentario, e uma `//` dentro de URL continua intocada.
 */
export function comentariosDe(cru: string, limpo: string): string {
  let saida = ''
  for (let i = 0; i < cru.length; i += 1) {
    const c = cru.charAt(i)
    if (c === '\n') {
      saida += '\n'
      continue
    }
    saida += limpo.charAt(i) === ' ' && c !== ' ' ? c : ' '
  }
  // A DECORACAO DA LINHA VIRA ESPACO — sem isto o guard so ve alegacao que cabe
  // numa linha. A forma mais comum no repositorio era a QUEBRADA:
  //
  //     * catalog-finalize.ts — Finalizacao editorial (Prisma). EXCLUIDO do
  //     * typecheck.
  //
  // com um `*` entre "do" e "typecheck". Enquanto ele estivesse la, `\s+` nao
  // atravessava e a alegacao passava verde. Foi assim que este guard quase
  // nasceu cego para metade dos casos que existia para pegar. O `\r` opcional
  // importa: a arvore esta em CRLF.
  return saida.replace(/^[ \t]*(\/\*\*?|\*\/|\*|\/\/)/gm, (m) => ' '.repeat(m.length))
}

function arquivosDeCodigo(): readonly string[] {
  const encontrados: string[] = []
  const andar = (dir: string): void => {
    let entradas
    try {
      entradas = readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const entrada of entradas) {
      const relativo = `${dir}/${entrada.name}`
      if (entrada.isDirectory()) {
        if (IGNORADOS.has(entrada.name)) continue
        andar(relativo)
        continue
      }
      if (!/\.[cm]?tsx?$/.test(entrada.name)) continue
      if (relativo === ESTE_GUARD) continue
      encontrados.push(relativo)
    }
  }
  for (const raiz of RAIZES) andar(raiz)
  return encontrados.sort()
}

// ---------------------------------------------------------------------------
// 4. OS TESTES
// ---------------------------------------------------------------------------

describe('alegacao de exclusao do typecheck', () => {
  it('nenhum arquivo alega exclusao de um programa que o cobre', () => {
    const infratores: string[] = []

    for (const relativo of arquivosDeCodigo()) {
      const cru = readSourceRaw(relativo, MOTIVO_CRU)
      if (!/typecheck|type-check|tsconfig|tsc\b/i.test(cru)) continue

      const comentarios = comentariosDe(cru, stripComments(cru, 'c-like'))
      const alegacoes = acharAlegacoes(comentarios)
      if (alegacoes.length === 0) continue

      const cobertura = coberturaDe(relativo)
      for (const alegacao of alegacoes) {
        if (alegacaoConfere(alegacao, cobertura)) continue
        const onde =
          cobertura.raiz && cobertura.runtime
            ? `${TSCONFIG_RAIZ} E ${TSCONFIG_RUNTIME}`
            : cobertura.raiz
              ? TSCONFIG_RAIZ
              : TSCONFIG_RUNTIME
        infratores.push(
          `${relativo}: o comentario diz ${JSON.stringify(alegacao.texto)} ` +
            `(programa: ${alegacao.programa}), mas o arquivo ESTA em ${onde}. ` +
            'Corrija o comentario — nao o tsconfig.',
        )
      }
    }

    expect(infratores).toEqual([])
  })

  /**
   * O controle da propria regua.
   *
   * O decisor acima e uma REIMPLEMENTACAO da semantica de glob do TypeScript, e
   * uma reimplementacao permissiva demais deixaria o guard verde por engano —
   * exatamente o modo de falha que este repositorio ja coleciona. Aqui o
   * compilador de verdade responde qual e a lista de arquivos-raiz de cada
   * programa, e as duas respostas tem de bater ARQUIVO A ARQUIVO.
   *
   * (Foi este teste que pegou o primeiro erro da reimplementacao: um ponto
   * escapado a mais fazia `*.ts` nao casar com `import.test.ts`, e todo arquivo
   * com ponto extra no nome aparecia como "fora do typecheck".)
   */
  it('o decisor de globs concorda com o proprio TypeScript, arquivo a arquivo', () => {
    const arquivos = arquivosDeCodigo()

    for (const [tsconfig, decisor] of [
      [TSCONFIG_RAIZ, decisorRaiz],
      [TSCONFIG_RUNTIME, decisorRuntime],
    ] as const) {
      const lido = ts.readConfigFile(path.join(REPO_ROOT, tsconfig), (p) =>
        readSourceRaw(p, MOTIVO_CRU),
      )
      expect(lido.error, `${tsconfig} deveria ser legivel`).toBeUndefined()

      const analisado = ts.parseJsonConfigFileContent(
        lido.config,
        ts.sys,
        REPO_ROOT,
        undefined,
        path.join(REPO_ROOT, tsconfig),
      )
      const doCompilador = new Set(
        analisado.fileNames.map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/')),
      )

      const divergentes = arquivos.filter((f) => decisor(f) !== doCompilador.has(f))
      expect(divergentes, `divergencia contra ${tsconfig}`).toEqual([])
    }
  })

  it('a lista de exclusao continua NOMINAL — nenhum `services/**\\/persistence/**` amplo', () => {
    // Se alguem trocar as duas entradas por servico por uma regra ampla, a
    // cobertura de entity-writer/ratings/streaming/user-platform cai em
    // silencio e todos os cabecalhos que este guard acabou de corrigir voltam a
    // ficar errados — no sentido oposto. Preferimos que a mudanca seja
    // deliberada e passe por aqui.
    const { exclude } = lerGlobs(TSCONFIG_RAIZ)
    expect(exclude).toContain('services/ingestion/**/persistence/**')
    expect(exclude).toContain('services/news-ingestion/**/persistence/**')
    expect(exclude.filter((e) => e.includes('persistence'))).toHaveLength(2)
  })
})

describe('detector de alegacao (unidade)', () => {
  const COBERTO_RAIZ: Cobertura = { raiz: true, runtime: false }
  const COBERTO_RUNTIME: Cobertura = { raiz: false, runtime: true }
  const FORA_DE_TUDO: Cobertura = { raiz: false, runtime: false }

  it('le a alegacao ABSOLUTA e exige exclusao dos dois programas', () => {
    const [alegacao] = acharAlegacoes('EXCLUIDO do typecheck.')
    expect(alegacao?.programa).toBe('ambos')
    expect(alegacaoConfere(alegacao!, FORA_DE_TUDO)).toBe(true)
    expect(alegacaoConfere(alegacao!, COBERTO_RAIZ)).toBe(false)
    expect(alegacaoConfere(alegacao!, COBERTO_RUNTIME)).toBe(false)
  })

  it('le o qualificador de RAIZ e nao se importa com o runtime', () => {
    for (const texto of [
      'fora do typecheck principal',
      'EXCLUIDO DO TYPECHECK padrao',
      'fora do typecheck da raiz',
      'Fora do `tsconfig.json` principal',
      'fora do tsconfig principal',
    ]) {
      const [alegacao] = acharAlegacoes(texto)
      expect(alegacao?.programa, texto).toBe('raiz')
      expect(alegacaoConfere(alegacao!, COBERTO_RUNTIME), texto).toBe(true)
      expect(alegacaoConfere(alegacao!, COBERTO_RAIZ), texto).toBe(false)
    }
  })

  it('le o qualificador de RUNTIME', () => {
    const [alegacao] = acharAlegacoes('fora do `tsconfig.runtime.json`')
    expect(alegacao?.programa).toBe('runtime')
    expect(alegacaoConfere(alegacao!, COBERTO_RAIZ)).toBe(true)
    expect(alegacaoConfere(alegacao!, COBERTO_RUNTIME)).toBe(false)
  })

  it('NAO le "fora" que governa outra coisa', () => {
    // O caso vivo: os bins listados no runtime dizem as duas coisas na mesma
    // frase — estao fora do BUNDLE e dentro do TYPECHECK. Um detector de janela
    // ("as duas palavras aparecem perto") reprovaria a frase correta.
    expect(
      acharAlegacoes('Fica em `services/ratings/bin`: fora do bundle de render, mas COBERTO pelo typecheck.'),
    ).toEqual([])
  })

  it('NAO le afirmacao sobre um CASO em vez de um arquivo', () => {
    expect(acharAlegacoes('o typecheck nao alcanca esse caso, so o runtime.')).toEqual([])
    expect(acharAlegacoes('dois erros que o typecheck nao pega e que so apareceriam em producao')).toEqual([])
  })

  it('NAO le alegacao entre aspas duplas — citar nao e afirmar', () => {
    const texto =
      'COBERTO pelo typecheck da raiz. O cabecalho dizia "EXCLUIDO do typecheck principal" e isso era FALSO.'
    expect(acharAlegacoes(texto)).toEqual([])
  })

  it('le a forma negativa ("nao e typechecked") como absoluta', () => {
    const [alegacao] = acharAlegacoes('Subconjunto do detalhe TMDB (bin nao e typechecked).')
    expect(alegacao?.programa).toBe('ambos')
  })

  it('le a forma INVERTIDA, mas so quando o objeto e um arquivo', () => {
    // Duas frases quase iguais, com verdades opostas. A diferenca esta no
    // objeto: "este arquivo" fala de filiacao no programa; "esse caso" fala de
    // um cenario de runtime que nenhum tipo poderia cobrir.
    const [alegacao] = acharAlegacoes('O typecheck nao cobre este arquivo.')
    expect(alegacao?.programa).toBe('ambos')
    expect(alegacaoConfere(alegacao!, COBERTO_RAIZ)).toBe(false)

    expect(acharAlegacoes('o typecheck nao alcanca esse caso, so o runtime.')).toEqual([])
  })
})

describe('extracao de comentario (unidade)', () => {
  const extrair = (fonte: string): string => comentariosDe(fonte, stripComments(fonte, 'c-like'))

  it('enxerga a alegacao QUEBRADA em duas linhas de bloco', () => {
    const fonte = ['/**', ' * store.ts — Adapter (Prisma). EXCLUIDO do', ' * typecheck.', ' */'].join(
      '\n',
    )
    const [alegacao] = acharAlegacoes(extrair(fonte))
    expect(alegacao?.programa).toBe('ambos')
  })

  it('enxerga a alegacao quebrada tambem em CRLF', () => {
    const fonte = ['/**', ' * Adapter (Prisma). EXCLUIDO do', ' * typecheck principal.', ' */'].join(
      '\r\n',
    )
    const [alegacao] = acharAlegacoes(extrair(fonte))
    expect(alegacao?.programa).toBe('raiz')
  })

  it('nao le CODIGO como comentario, nem come `//` dentro de string', () => {
    const fonte = ['const url = "https://exemplo.com//rota"', 'const fora = "EXCLUIDO do typecheck"'].join(
      '\n',
    )
    const comentarios = extrair(fonte)
    expect(comentarios.trim()).toBe('')
    expect(acharAlegacoes(comentarios)).toEqual([])
  })
})

describe('decisor de globs (unidade)', () => {
  it('exclude de DIRETORIO alcanca tudo abaixo dele', () => {
    const decisor = criarDecisor({ include: ['servico/**/*.ts'], exclude: ['servico/bin'] })
    expect(decisor('servico/src/a.ts')).toBe(true)
    expect(decisor('servico/bin/a.ts')).toBe(false)
    expect(decisor('servico/bin/fundo/a.ts')).toBe(false)
  })

  it('`*` do include atravessa ponto — `a.test.ts` casa com `*.ts`', () => {
    const decisor = criarDecisor({ include: ['servico/**/*.ts'], exclude: [] })
    expect(decisor('servico/src/a.test.ts')).toBe(true)
    expect(decisor('servico/src/a.ts')).toBe(true)
    expect(decisor('servico/src/a.tsx')).toBe(false)
  })

  it('`**` no meio do exclude casa zero ou mais niveis', () => {
    const decisor = criarDecisor({
      include: ['servico/**/*.ts'],
      exclude: ['servico/**/persistence/**'],
    })
    expect(decisor('servico/persistence/a.ts')).toBe(false)
    expect(decisor('servico/src/persistence/a.ts')).toBe(false)
    expect(decisor('servico/src/persistence/fundo/a.ts')).toBe(false)
    expect(decisor('servico/src/outro/a.ts')).toBe(true)
  })

  it('arquivo avulso no exclude tira so ele', () => {
    const decisor = criarDecisor({
      include: ['servico/**/*.ts'],
      exclude: ['servico/src/composition.ts'],
    })
    expect(decisor('servico/src/composition.ts')).toBe(false)
    expect(decisor('servico/src/composition-outro.ts')).toBe(true)
  })
})
