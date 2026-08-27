/**
 * catalog-mass-change.ts — FREIO de mudanca em massa da indexabilidade (PURO).
 *
 * POR QUE ESTE MODULO EXISTE
 * --------------------------
 * `catalog index-decisions --apply` roda de HORA EM HORA, sem humano nenhum
 * (`scripts/catalog/catalog-cycle-with-alert.sh`, timer systemd). O produtor le
 * a politica pura de `catalog-indexability.ts` e persiste o veredito. Isso
 * significa que qualquer alteracao na politica — ou um bump de
 * `CATALOG_POLICY_VERSION` acompanhado de regra nova — se aplicaria ao catalogo
 * INTEIRO no primeiro ciclo depois do deploy.
 *
 * A secao 6 do CLAUDE.md exige revisao HUMANA para "indexacao em massa (mudar
 * muitas paginas para index/noindex)". Um cron horario nao e revisao humana.
 * Este modulo e o que transforma essa exigencia em codigo: conta quantas
 * entidades MUDAM DE LADO e recusa a escrita quando o numero passa do teto.
 *
 * O QUE E UM "FLIP" — E POR QUE NAO E "QUALQUER MUDANCA DE VEREDITO"
 * ------------------------------------------------------------------
 * O sitemap le a tabela assim (`apps/web/src/server/seo/sitemap-index.ts`):
 *
 *   AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions d
 *     WHERE ... AND d.is_current = true AND d.decision <> 'index')
 *
 * Ou seja: **AUSENCIA de decisao significa DENTRO do sitemap**. Uma entidade sem
 * linha nenhuma esta tao no sitemap quanto uma com `decision='index'`. Disso sai
 * a unica definicao de flip que mede EFEITO em vez de rotulo:
 *
 *   null    -> index                 : NAO e flip (ja estava dentro)
 *   null    -> noindex/draft/blocked : E flip     (SAI do sitemap)
 *   index   -> noindex/draft/blocked : E flip     (SAI do sitemap)
 *   noindex -> index                 : E flip     (ENTRA no sitemap)
 *   noindex -> draft                 : NAO e flip (continua fora; so mudou a razao)
 *
 * Consequencias praticas dessa escolha:
 *
 *  - O CRESCIMENTO NORMAL do catalogo passa livre. Entidade nova que finaliza
 *    com slug + titulo + traducao vira `null -> index`: zero flips. O freio nao
 *    atrapalha a ingestao, que e justamente o trabalho do ciclo horario.
 *  - Um bump de `CATALOG_POLICY_VERSION` SOZINHO passa livre: reemite as linhas
 *    com o mesmo veredito, zero flips, zero mudanca de sitemap. O que o freio
 *    pega e o bump ACOMPANHADO de regra nova — o caso perigoso.
 *  - Uma politica que tire 50.716 paginas do sitemap conta 50.716 flips e para.
 *
 * COMO O TETO E CONFIGURADO
 * -------------------------
 * Dois tetos, em OU: absoluto (`maxFlips`) e proporcional (`maxFlipRatio`). O
 * absoluto protege catalogo grande, onde 5% ainda sao milhares de paginas; o
 * proporcional protege catalogo pequeno, onde 500 flips seriam o acervo inteiro.
 *
 * Efeito colateral aceito e documentado: num banco pequeno (dev, staging com
 * dezenas de entidades) o teto proporcional dispara com pouquissimos flips. E o
 * comportamento correto — 1 em 10 paginas E uma mudanca de 10%. Quem opera banco
 * pequeno afrouxa com `--max-flip-percent`.
 *
 * ESTE MODULO NAO GRAVA E NAO DECIDE POLITICA. Ele so conta e compara. Quem
 * decide o veredito de cada entidade e `catalog-indexability.ts`; quem obedece o
 * freio e `services/ingestion/src/persistence/indexability-writer.ts`.
 *
 * MODULO PURO: sem banco, sem rede, sem relogio.
 */

/** O unico veredito que mantem a entidade DENTRO do sitemap. */
export const SITEMAP_INDEXED_DECISION = "index";

/**
 * A entidade esta (ou ficara) dentro do sitemap?
 *
 * `null` = sem linha vigente = DENTRO. Inverter esta polaridade inverte o freio
 * inteiro — por isso ela tem teste proprio.
 *
 * ATENCAO — ESTA POLARIDADE DEIXOU DE SER UNIVERSAL EM 2026-08-27.
 * -----------------------------------------------------------------
 * Ela era uma consequencia direta do SQL do sitemap, que excluia so quando havia
 * linha vigente `decision <> 'index'`. Esse SQL foi INVERTIDO
 * (`apps/web/src/server/seo/sitemap-index.ts`): passa a entrar quem TEM linha
 * vigente `index`, e a inversao ARMA por tipo quando a cobertura de decisoes
 * cruza `SITEMAP_DECISION_GATE_MIN_ROWS`. Ou seja, o significado de `null`
 * depende de quantas linhas existem:
 *
 *   gate DESARMADO (tabela vazia/rasa)  ->  null = DENTRO   (o que esta aqui)
 *   gate ARMADO    (cobertura acima do piso) ->  null = FORA
 *
 * POR QUE NAO FOI MUDADO JUNTO. Na PRIMEIRA execucao do produtor contra um banco
 * sem decisoes — que e o unico cenario em que ha `null` em massa — o gate ainda
 * esta desarmado, e esta polaridade e a CORRETA: `null -> noindex` de fato tira a
 * pagina do sitemap, e e isso que o freio precisa contar para exigir assinatura
 * humana (CLAUDE.md secao 6). Mudar a polaridade aqui agora faria o freio contar
 * ZERO na execucao em que ele mais importa.
 *
 * O QUE FICA PENDENTE. Depois que o gate armar, `null -> index` passa a ser uma
 * ENTRADA real no sitemap e este classificador continuara chamando de `no_flip`.
 * Isso e deliberado hoje (o freio existe para pegar mudanca de POLITICA, e o
 * proprio cabecalho deste modulo diz que crescimento normal de catalogo passa
 * livre), mas deixa de ser obviamente certo quando entrada em massa vier de uma
 * mudanca de politica. Corrigir exige o produtor LER a cobertura antes de
 * classificar — mudanca de comportamento do freio, e portanto decisao humana,
 * nao efeito colateral desta leva.
 */
export function isEffectivelyIndexed(decision: string | null): boolean {
  return decision === null || decision === SITEMAP_INDEXED_DECISION;
}

/** Direcao da mudanca de lado. */
export type IndexFlip = "enters_index" | "leaves_index" | "no_flip";

/** Classifica a transicao de UMA entidade pelo efeito no sitemap. */
export function classifyIndexFlip(previous: string | null, next: string): IndexFlip {
  const was = isEffectivelyIndexed(previous);
  const will = isEffectivelyIndexed(next);
  if (was === will) return "no_flip";
  return will ? "enters_index" : "leaves_index";
}

/** Tetos do freio. Disparam em OU: passar de QUALQUER um dos dois trava. */
export interface MassChangeThresholds {
  /** Numero absoluto de flips tolerado por execucao. */
  readonly maxFlips: number;
  /** Fracao de flips sobre as entidades avaliadas (0..1). */
  readonly maxFlipRatio: number;
}

/**
 * Tetos default.
 *
 * 500 / 5% saem do tamanho real do catalogo: com ~53k entidades avaliadas, a
 * deriva normal de uma hora e da ordem de dezenas, e a mudanca de politica que
 * motivou este freio (53.054 -> 2.338 URLs) flipa ~95%. Os dois tetos pegam a
 * segunda sem encostar na primeira.
 */
export const DEFAULT_MASS_CHANGE_THRESHOLDS: MassChangeThresholds = {
  maxFlips: 500,
  maxFlipRatio: 0.05,
};

/** Uma transicao PLANEJADA (ainda nao gravada). */
export interface PlannedTransition {
  readonly entityType: string;
  /** Veredito vigente persistido; `null` quando nao ha linha. */
  readonly previousDecision: string | null;
  readonly nextDecision: string;
  /** Razao ESTRUTURADA da decisao nova (alimenta o censo). */
  readonly nextReason: string;
}

/** Censo dos flips de uma execucao. */
export interface MassChangeCensus {
  /** Entidades avaliadas (denominador do teto proporcional). */
  readonly evaluated: number;
  readonly entersIndex: number;
  readonly leavesIndex: number;
  /** Flips por razao da decisao NOVA — o "por que" que o operador precisa ler. */
  readonly byReason: Readonly<Record<string, number>>;
  /** Flips por tipo de entidade. */
  readonly byEntityType: Readonly<Record<string, number>>;
}

/**
 * Monta o censo a partir das transicoes planejadas.
 *
 * `evaluated` vem de fora (e o total varrido, nao o total que mudou): sem ele o
 * teto proporcional mediria flips sobre flips e daria sempre 100%.
 */
export function censusMassChange(
  transitions: readonly PlannedTransition[],
  evaluated: number,
): MassChangeCensus {
  const byReason: Record<string, number> = {};
  const byEntityType: Record<string, number> = {};
  let entersIndex = 0;
  let leavesIndex = 0;

  for (const t of transitions) {
    const flip = classifyIndexFlip(t.previousDecision, t.nextDecision);
    if (flip === "no_flip") continue;
    if (flip === "enters_index") entersIndex += 1;
    else leavesIndex += 1;
    byReason[t.nextReason] = (byReason[t.nextReason] ?? 0) + 1;
    byEntityType[t.entityType] = (byEntityType[t.entityType] ?? 0) + 1;
  }

  return {
    evaluated: Math.max(0, Math.floor(evaluated)),
    entersIndex,
    leavesIndex,
    byReason: Object.freeze(byReason),
    byEntityType: Object.freeze(byEntityType),
  };
}

/** Qual teto foi estourado. */
export type MassChangeTrigger = "absolute" | "ratio";

/** Veredito do freio. */
export interface MassChangeVerdict {
  readonly evaluated: number;
  readonly flips: number;
  readonly entersIndex: number;
  readonly leavesIndex: number;
  /** flips / evaluated (0 quando nada foi avaliado). */
  readonly flipRatio: number;
  readonly limits: MassChangeThresholds;
  /**
   * ARITMETICA pura: os flips passaram de algum teto? Independe do opt-in — e o
   * que permite ao `--confirm-mass-change` REGISTRAR que houve mudanca em massa
   * em vez de apagar o fato.
   */
  readonly exceeded: boolean;
  readonly exceededBy: readonly MassChangeTrigger[];
  /** O operador passou `--confirm-mass-change`? */
  readonly confirmed: boolean;
  /** `exceeded && !confirmed`. Quando true, NADA pode ser gravado. */
  readonly blocked: boolean;
  readonly explanation: string;
}

/** Aplica defaults e sanea os tetos vindos da CLI. */
export function resolveMassChangeThresholds(
  partial?: Partial<MassChangeThresholds>,
): MassChangeThresholds {
  const maxFlips = partial?.maxFlips;
  const maxFlipRatio = partial?.maxFlipRatio;
  return {
    maxFlips:
      typeof maxFlips === "number" && Number.isFinite(maxFlips)
        ? Math.max(0, Math.floor(maxFlips))
        : DEFAULT_MASS_CHANGE_THRESHOLDS.maxFlips,
    maxFlipRatio:
      typeof maxFlipRatio === "number" && Number.isFinite(maxFlipRatio)
        ? Math.min(1, Math.max(0, maxFlipRatio))
        : DEFAULT_MASS_CHANGE_THRESHOLDS.maxFlipRatio,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Decide se a execucao pode gravar.
 *
 * Comparacao ESTRITA (`>`): um teto de 500 tolera exatamente 500 flips e trava
 * no 501. Teto e o ultimo valor aceito, nao o primeiro recusado.
 */
export function evaluateMassChangeBrake(input: {
  readonly census: MassChangeCensus;
  readonly thresholds?: Partial<MassChangeThresholds>;
  readonly confirmed: boolean;
}): MassChangeVerdict {
  const limits = resolveMassChangeThresholds(input.thresholds);
  const { evaluated, entersIndex, leavesIndex } = input.census;
  const flips = entersIndex + leavesIndex;
  const flipRatio = evaluated === 0 ? 0 : flips / evaluated;

  const exceededBy: MassChangeTrigger[] = [];
  if (flips > limits.maxFlips) exceededBy.push("absolute");
  if (flipRatio > limits.maxFlipRatio) exceededBy.push("ratio");
  const exceeded = exceededBy.length > 0;
  const blocked = exceeded && !input.confirmed;

  const scale =
    `${flips} flip(s) em ${evaluated} avaliada(s) (${pct(flipRatio)})` +
    ` · entram ${entersIndex} · saem ${leavesIndex}`;
  const caps = `tetos: ${limits.maxFlips} absoluto · ${pct(limits.maxFlipRatio)} proporcional`;
  const burst = exceededBy.join(" e ");

  let explanation: string;
  if (!exceeded) {
    explanation = `deriva normal: ${scale}; ${caps}.`;
  } else if (input.confirmed) {
    explanation =
      `MUDANCA EM MASSA CONFIRMADA por --confirm-mass-change: ${scale}; ${caps}` +
      ` (estourou: ${burst}).`;
  } else {
    explanation =
      `MUDANCA EM MASSA RECUSADA: ${scale}; ${caps} (estourou: ${burst}).` +
      ` Nada foi gravado. CLAUDE.md secao 6 exige revisao HUMANA para indexacao em massa:` +
      ` revise com --dry-run e, se a mudanca for intencional, repita com --confirm-mass-change.`;
  }

  return {
    evaluated,
    flips,
    entersIndex,
    leavesIndex,
    flipRatio,
    limits,
    exceeded,
    exceededBy: Object.freeze(exceededBy),
    confirmed: input.confirmed,
    blocked,
    explanation,
  };
}
