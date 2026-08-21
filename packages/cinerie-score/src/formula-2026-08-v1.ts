/**
 * formula-2026-08-v1.ts — A PRIMEIRA formula aprovada do Cinerie Score.
 *
 * ============================================================================
 * QUEM DECIDIU
 * ============================================================================
 * Pablo Eduardo, proprietario da Cinerie, em 20/08/2026. Este arquivo IMPLEMENTA
 * a decisao; ele nao a toma. Escala, fontes, pesos, piso de exibicao e
 * tratamento de ausencia vieram fechados — o criterio de cada um esta abaixo,
 * para que ninguem reabra a discussao lendo so o codigo.
 *
 * Ate aqui `PRODUCTION_FORMULA_REGISTRY` estava VAZIO de proposito, e o engine
 * devolvia `blocked_by_decision`. Esse estado era correto enquanto a decisao nao
 * existia. Agora existe.
 *
 * ============================================================================
 * A FORMULA
 * ============================================================================
 * Normaliza tudo para 0-100:
 *
 *   IMDb              0-10   -> v x 10
 *   TMDB              0-10   -> v x 10
 *   Rotten Tomatoes   0-100  -> v
 *   Metacritic        0-100  -> v
 *
 * Dois grupos:
 *
 *   CRITICA = media SIMPLES das que existirem entre { rotten_tomatoes, metacritic }
 *   PUBLICO = media PONDERADA das que existirem entre { imdb (peso 3), tmdb (peso 1) }
 *
 * O numero:
 *
 *   os dois grupos existem -> 0,5 x CRITICA + 0,5 x PUBLICO
 *   so um existe           -> esse grupo
 *   arredonda para inteiro, 0-100
 *
 * ============================================================================
 * OS CRITERIOS (para nao reabrir)
 * ============================================================================
 * PESO 3 DO IMDB SOBRE 1 DO TMDB. Amostra muito maior e referencia reconhecida
 * de publico. A media do TMDB e fina e enviesada por quem usa a API.
 *
 * 50/50 ENTRE CRITICA E PUBLICO. E a posicao editorial. Um site so de critica
 * ranqueia diferente do que o leitor vive; um site so de publico vira termometro
 * de bilheteria.
 *
 * PISO DE DUAS FONTES (aplicado na EXIBICAO, ver `MINIMUM_COUNTED_SOURCES`).
 * Cobertura medida em producao: IMDb 88%, Rotten 60%, Metacritic 44% no topo do
 * catalogo, e despenca abaixo. Sem o piso, milhares de titulos exibiriam o IMDb
 * disfarcado de nota da casa — lavar o numero de um terceiro e chamar de nosso.
 *
 * ROTTEN "AUDIENCE" NAO ENTRA NO PUBLICO. Vem do RapidAPI, que esta revogado. So
 * a nota de CRITICA do Rotten entra, e no grupo de critica.
 *
 * ============================================================================
 * VOLUME MINIMO DE VOTOS
 * ============================================================================
 * TMDB: so conta com `count >= 50`. Abaixo disso e ruido.
 *
 * IMDb: NAO E FILTRAVEL POR VOLUME, e isso e um fato do fornecedor, nao uma
 * escolha. A OMDb nao publica contagem de votos POR FONTE no array de ratings
 * (`services/ratings/src/omdb/mapping.ts:230-233` grava `ratingCount: null` e
 * explica: `imdbVotes` existe no topo do payload, mas e do IMDb e nao do
 * descritor — associa-lo seria afirmar uma contagem que a fonte nao declarou).
 *
 * Entao, conforme decidido: NAO se inventa teto. `count === null` no IMDb CONTA
 * a fonte. O que NAO se faz e tratar `null` como zero (excluiria o IMDb de tudo)
 * nem como um numero grande fabricado.
 *
 * A assimetria e deliberada e so vale para fonte cuja contagem e estruturalmente
 * indisponivel. Descartar o IMDb por falta de um campo que o fornecedor nao
 * manda apagaria a fonte de MAIOR cobertura do catalogo (88%) — e, com o piso de
 * duas fontes, derrubaria o Score de quase todo titulo.
 *
 * ============================================================================
 * PUREZA
 * ============================================================================
 * Sem rede, sem banco, sem `Date` proprio (o `now` vem do contexto). Roda
 * offline, em worker — nunca no caminho de render (invariantes 3 e 4).
 */

import type {
  CinerieScoreExplanationEntry,
  CinerieScoreFormula,
  CinerieScoreInput,
  CinerieScoreRatingInput,
  CinerieScoreResult,
} from "./types.js";

/** A versao desta formula. E o elo com a decisao que a aprovou. */
export const CINERIE_SCORE_FORMULA_V1 = "cinerie-score/2026-08-v1";

/** Escala de saida. Sempre 0-100, inteiro. */
export const CINERIE_SCORE_SCALE = 100;

/**
 * Piso de fontes CONTADAS para o numero poder ser exibido.
 *
 * Com uma fonte so nao existe composicao: seria lavar o numero de um terceiro e
 * chamar de nosso. A regra e inegociavel e vive junto da formula porque e parte
 * da decisao, nao configuracao de tela.
 */
export const MINIMUM_COUNTED_SOURCES = 2;

/** Piso de votos do TMDB. Abaixo disso a media e ruido. */
export const TMDB_MINIMUM_VOTE_COUNT = 50;

/** As fontes do grupo CRITICA, com a escala canonica de cada uma. */
const CRITICS_SOURCES: Readonly<Record<string, number>> = {
  rotten_tomatoes: 100,
  metacritic: 100,
};

/** As fontes do grupo PUBLICO: escala canonica e PESO. */
const AUDIENCE_SOURCES: Readonly<
  Record<string, { readonly best: number; readonly weight: number }>
> = {
  imdb: { best: 10, weight: 3 },
  tmdb: { best: 10, weight: 1 },
};

/** Uma fonte que sobreviveu a todos os filtros e vai compor o numero. */
export interface CountedSource {
  readonly source: string;
  /** Valor ja em 0-100. */
  readonly normalized: number;
  readonly group: "critics" | "audience";
  readonly weight: number;
}

/**
 * O GRUPO de uma fonte, derivado da propria fonte.
 *
 * ============================================================================
 * POR QUE ISTO EXISTE (e por que nao existia)
 * ============================================================================
 * `group` nunca foi propriedade do CALCULO: e propriedade da FONTE. Rotten
 * Tomatoes e Metacritic sao critica; IMDb e TMDB sao publico. O mapa esta
 * declarado logo acima, e sempre esteve.
 *
 * Mas `CinerieScoreExplanationEntry` — a forma persistida em
 * `cinerie_score_calculations.explanation` — nao carrega `group`. Quem lesse a
 * explicacao para remontar `CountedSource[]` ficava sem o campo, e o consumidor
 * era obrigado a inventar um. Foi o que aconteceu em
 * `apps/web/src/server/entity-hero.ts`, com o comentario admitindo a invencao:
 * "`audience` e um valor valido do tipo para satisfazer a forma".
 *
 * Um valor inventado para satisfazer um tipo e uma mentira que compila. Hoje ela
 * e inofensiva (o presenter so conta fontes NOMEADAS e nao le `group`); no dia
 * em que alguem exibir "criticos x publico" a partir dessa reconstrucao, o
 * Rotten Tomatoes apareceria como publico.
 *
 * A cura nao e persistir o grupo — e nunca precisar dele persistido. Quem sabe o
 * grupo e ESTE modulo, que e dono do mapa; o consumidor pergunta em vez de
 * decidir.
 *
 * Devolve `null` para fonte fora da formula. `null` NAO e "publico por
 * omissao": uma fonte desconhecida nao tem grupo, e chutar um seria repetir o
 * defeito num lugar novo.
 */
export function resolveSourceGroup(source: string): "critics" | "audience" | null {
  if (CRITICS_SOURCES[source] !== undefined) return "critics";
  if (AUDIENCE_SOURCES[source] !== undefined) return "audience";
  return null;
}

/**
 * Remonta `CountedSource[]` a partir da EXPLICACAO persistida.
 *
 * ============================================================================
 * POR QUE ISTO E UMA FUNCAO, E NAO TRES LINHAS NO CONSUMIDOR
 * ============================================================================
 * Porque tres linhas no consumidor nao tem teste. A primeira versao deste
 * conserto deixou a remontagem inline em `entity-hero.ts` e "protegeu" o
 * comportamento com um guard TEXTUAL, procurando a linha exata que existia
 * antes. Ao verificar o guard por mutacao, ele PASSOU com o defeito de volta:
 * a mutacao usou `const group = "audience"` e o guard procurava
 * `group: "audience"` — outra grafia, mesmo defeito, guard cego.
 *
 * Guard de FORMA so pega a grafia que ja se conhece. Guard de COMPORTAMENTO
 * pega o defeito. Entao a remontagem virou funcao pura, e o teste chama a
 * funcao em vez de ler o arquivo.
 *
 * Entrada sem grupo conhecido e DESCARTADA (nao "vira publico"): uma fonte fora
 * da formula nao compoe o numero, e dar a ela um grupo por omissao seria
 * reintroduzir a invencao num lugar novo.
 */
export function rebuildCountedSources(
  entries: readonly { readonly source: string; readonly normalized: number; readonly weight: number }[],
): readonly CountedSource[] {
  const out: CountedSource[] = [];
  for (const entry of entries) {
    const group = resolveSourceGroup(entry.source);
    if (group === null) continue;
    out.push({
      source: entry.source,
      normalized: entry.normalized,
      group,
      weight: entry.weight,
    });
  }
  return out;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Normaliza UMA nota para 0-100, ou devolve `null` se ela nao pode entrar.
 *
 * Cada recusa e um caso real, nao defensividade decorativa:
 *  - fonte fora das quatro decididas;
 *  - escala declarada diferente da escala canonica da fonte — aceitar seria
 *    reescalar entre fontes, a transformacao proibida pela invariante 1;
 *  - valor nao finito, negativo, ou acima da propria escala;
 *  - Rotten/Metacritic com `type` de AUDIENCIA: so a nota de critica entra, e
 *    a audience do Rotten vem do RapidAPI revogado;
 *  - TMDB abaixo do piso de votos.
 */
export function normalizeRating(rating: CinerieScoreRatingInput): CountedSource | null {
  if (!isFiniteNumber(rating.value) || rating.value < 0) return null;

  const criticsBest = CRITICS_SOURCES[rating.source];
  if (criticsBest !== undefined) {
    // A nota de CRITICA, so. `audience` do Rotten vem do RapidAPI (revogado) e
    // nao tem lugar no grupo de publico desta formula.
    if (rating.type === "audience") return null;
    if (rating.best !== criticsBest) return null;
    if (rating.value > criticsBest) return null;
    return {
      source: rating.source,
      normalized: (rating.value / criticsBest) * 100,
      group: "critics",
      weight: 1,
    };
  }

  const audience = AUDIENCE_SOURCES[rating.source];
  if (audience === undefined) return null;
  if (rating.best !== audience.best) return null;
  if (rating.value > audience.best) return null;

  if (rating.source === "tmdb") {
    // `null` no TMDB NAO passa: aqui a contagem existe de verdade
    // (`vote_count_tmdb` esta na propria linha do titulo), entao ausencia e
    // anomalia, nao limitacao do fornecedor. Tratar como "sem piso" abriria a
    // porta ao ruido que o piso existe para barrar.
    if (!isFiniteNumber(rating.count)) return null;
    if (rating.count < TMDB_MINIMUM_VOTE_COUNT) return null;
  }
  // IMDb: `count === null` CONTA. Ver o cabecalho — a OMDb nao publica contagem
  // por fonte, e inventar um teto seria pior que nao ter.

  return {
    source: rating.source,
    normalized: (rating.value / audience.best) * 100,
    group: "audience",
    weight: audience.weight,
  };
}

/**
 * As fontes que compoem o numero, deduplicadas por FONTE.
 *
 * A mesma fonte duas vezes (dois registros de IMDb, por exemplo) contaria duas
 * vezes no peso e satisfaria o piso de duas fontes com UMA — que e exatamente o
 * que o piso existe para impedir. A primeira ocorrencia vence; a entrada ja
 * chega canonicalizada e ordenada pelo engine.
 */
export function selectCountedSources(
  ratings: readonly CinerieScoreRatingInput[],
): readonly CountedSource[] {
  const out: CountedSource[] = [];
  const vistas = new Set<string>();
  for (const rating of ratings) {
    if (vistas.has(rating.source)) continue;
    const counted = normalizeRating(rating);
    if (counted === null) continue;
    vistas.add(rating.source);
    out.push(counted);
  }
  return out;
}

function mediaPonderada(fontes: readonly CountedSource[]): number | null {
  if (fontes.length === 0) return null;
  const pesoTotal = fontes.reduce((soma, f) => soma + f.weight, 0);
  if (pesoTotal <= 0) return null;
  return fontes.reduce((soma, f) => soma + f.normalized * f.weight, 0) / pesoTotal;
}

/** O resultado do calculo puro, antes de virar `CinerieScoreResult`. */
export interface ComposedScore {
  /** Inteiro 0-100. */
  readonly value: number;
  readonly counted: readonly CountedSource[];
  readonly critics: number | null;
  readonly audience: number | null;
}

/**
 * Compoe o numero a partir das fontes contadas. `null` quando nao ha nenhuma.
 *
 * NAO aplica o piso de exibicao — o piso e regra de EXIBICAO e vive em
 * `shouldDisplayCinerieScore`. Separados de proposito: um calculo com uma fonte
 * ainda e um calculo valido de REGISTRAR em `cinerie_score_calculations` (o
 * historico e auditavel); o que nao se pode e MOSTRAR.
 */
export function composeScore(ratings: readonly CinerieScoreRatingInput[]): ComposedScore | null {
  const counted = selectCountedSources(ratings);
  if (counted.length === 0) return null;

  const critics = mediaPonderada(counted.filter((f) => f.group === "critics"));
  const audience = mediaPonderada(counted.filter((f) => f.group === "audience"));

  const bruto =
    critics !== null && audience !== null ? 0.5 * critics + 0.5 * audience : (critics ?? audience);
  if (bruto === null) return null;

  // Clamp alem do arredondamento: a normalizacao ja garante 0-100, e o clamp
  // existe para que um erro futuro de escala vire numero fora de faixa aqui em
  // vez de atravessar calado ate a tela.
  const value = Math.min(CINERIE_SCORE_SCALE, Math.max(0, Math.round(bruto)));
  return { value, counted, critics, audience };
}

/**
 * O numero pode ir a TELA?
 *
 * Exibe se, e somente se, houver >= 2 fontes CONTADAS. Com uma so nao existe
 * composicao. Regra inegociavel — ver o cabecalho.
 */
export function shouldDisplayCinerieScore(counted: readonly CountedSource[]): boolean {
  return counted.length >= MINIMUM_COUNTED_SOURCES;
}

/**
 * A formula versionada, no formato que o engine consome.
 *
 * `explanation` carrega a contribuicao de cada fonte — e o que permite a tela
 * dizer COMO foi composto e DE QUANTAS fontes, NOMEANDO-as. Sem isso o numero
 * seria uma afirmacao sem lastro.
 */
export const cinerieScoreFormulaV1: CinerieScoreFormula = {
  version: CINERIE_SCORE_FORMULA_V1,
  compute(input: CinerieScoreInput, context): CinerieScoreResult {
    const composed = composeScore(input.ratings);
    const explanation: CinerieScoreExplanationEntry[] =
      composed === null
        ? []
        : composed.counted.map((f) => ({
            source: f.source,
            normalized: f.normalized,
            weight: f.weight,
          }));
    return {
      // Sem nenhuma fonte contada nao ha numero. O engine so chega aqui com
      // decisao aprovada; um titulo sem nota valida devolve 0 com explicacao
      // VAZIA — e e a explicacao vazia que faz a tela nao renderizar nada.
      value: composed?.value ?? 0,
      scale: CINERIE_SCORE_SCALE,
      version: CINERIE_SCORE_FORMULA_V1,
      inputsHash: context.inputsHash,
      explanation,
      calculatedAt: context.now.toISOString(),
    };
  },
};
