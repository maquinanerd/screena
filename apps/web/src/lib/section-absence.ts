/**
 * section-absence.ts — Uma secao que some tem de DIZER por que sumiu. PURO.
 *
 * O PROBLEMA. O contrato de dados reais e explicito: "nao mostrar blocos
 * editoriais vazios — se nao ha conteudo, a secao inteira nao renderiza". Isso
 * esta certo, e e o que evita placeholder inventado. Mas cumprido sozinho ele
 * produz um segundo defeito, mais caro que o primeiro: a pagina responde 200,
 * o bloco simplesmente nao esta la, e ninguem — nem quem opera, nem quem
 * publica — descobre a diferenca entre "este titulo nao tem oferta" e "o
 * registro de provedores nunca foi populado". As duas coisas se parecem
 * exatamente com nada.
 *
 * "Onde assistir" e o caso vivo: ha ZERO provedores autorizados no banco hoje,
 * e o bloco nao aparece em nenhum titulo. Visualmente, identico a um filme que
 * de fato nao esta em lugar nenhum.
 *
 * A REGRA. Ausencia silenciosa e defeito. A secao sai do DOM **e** o motivo vai
 * para log estruturado. Nunca as duas coisas ausentes.
 *
 * COMO ISSO E GARANTIDO, E NAO SO PEDIDO. `SectionDecision` e uma uniao
 * discriminada em que `rendered: false` obriga `absence` a existir e `value` a
 * ser `null` — o tipo nao deixa escrever "sumiu sem motivo". Quem consome e o
 * `<SectionBoundary>`, que emite o log no MESMO ponto em que decide nao
 * renderizar. Os dois fatos nao podem divergir porque sao a mesma linha.
 */

/** Blocos do canonico que podem faltar por ausencia de dado. */
export type SectionKey =
  | "avaliacoes"
  | "onde-assistir"
  | "cinerie-score"
  | "premios"
  | "guia-critica"
  | "mais-como-este"
  | "elenco"
  | "noticias";

/**
 * Por que o bloco nao renderizou.
 *
 * Cada motivo nomeia uma CAUSA acionavel, nao "vazio". A diferenca entre
 * `no_authorized_provider` (a maquina de licenca nao liberou ninguem) e
 * `no_offer_for_entity` (liberou, mas este titulo nao esta em lugar nenhum) e
 * a diferenca entre um comando de operacao pendente e um fato sobre o filme.
 */
export type SectionAbsenceReason =
  /** Nenhuma nota sobreviveu ao gate de licenca/credito/frescor. */
  | "no_authorized_rating"
  /**
   * NENHUMA oferta exibivel no catalogo inteiro — a cadeia de streaming nao foi
   * concluida (registro de provedores vazio, licenca nao aplicada ou nada
   * promovido). Alguem precisa agir, e nao adianta olhar este titulo.
   */
  | "no_authorized_provider"
  /**
   * Existe oferta exibivel em ALGUM titulo, mas nenhuma neste. E um fato sobre
   * a obra, nao um passo pendente — por isso `actionable: false`.
   */
  | "no_offer_for_entity"
  /** Nao existe formula de Cinerie Score aprovada (decisao humana pendente). */
  | "no_approved_formula"
  /**
   * NENHUMA faixa de premios exibivel no catalogo inteiro — passo de operacao
   * pendente, nao fato sobre este titulo. A licenca de premiacao existe no spec
   * desde 2026-08-13 (credito da OMDb), mas ela precisa estar aplicada NO BANCO
   * e a promocao precisa ter rodado DEPOIS disso: o credito e gravado na escrita
   * da linha. Ver docs/operations/awards-promotion-runbook.md secao 4.
   */
  | "no_awards_source"
  /**
   * Existe faixa exibivel em ALGUM titulo, mas nao neste. E fato sobre a obra
   * (nao ganhou nem concorreu a nada que a fonte registre), nao passo pendente
   * — por isso `actionable: false`.
   */
  | "no_awards_for_entity"
  /** Nenhum `content_block` de critica publicavel para esta entidade. */
  | "no_editorial_review"
  /** Nao existe dataset de recomendacao deterministico. */
  | "no_recommendation_dataset"
  /** O catalogo nao tem elenco para este titulo. */
  | "no_cast"
  /** Nenhum artigo publicado vinculado a esta entidade. */
  | "no_linked_article";

/** Uma linha de log estruturada. Sem segredo, sem payload cru, sem PII. */
export interface SectionAbsence {
  readonly event: "section_absent";
  readonly section: SectionKey;
  readonly reason: SectionAbsenceReason;
  readonly entityType: "movie" | "tv";
  /** Id local da entidade — e o que permite ao operador achar o titulo. */
  readonly entityId: string;
  /**
   * Alguem precisa AGIR para este bloco acender?
   *
   * `true` quando a causa e um passo de operacao/decisao pendente (registro de
   * provedores nao populado, formula nao aprovada, fonte nao ingerida).
   * `false` quando a causa e um fato sobre o titulo (este filme nao esta em
   * nenhum streaming, esta serie nao tem materia). Sem esta separacao o log
   * vira ruido: um catalogo inteiro emitindo "sem oferta" afogaria o unico
   * evento que importa.
   */
  readonly actionable: boolean;
}

/** Causas que dependem de alguem agir (operacao ou decisao), nao do titulo. */
const ACTIONABLE_REASONS: ReadonlySet<SectionAbsenceReason> = new Set([
  "no_authorized_provider",
  "no_approved_formula",
  "no_awards_source",
  "no_recommendation_dataset",
]);

export interface SectionAbsenceContext {
  readonly section: SectionKey;
  readonly reason: SectionAbsenceReason;
  readonly entityType: "movie" | "tv";
  readonly entityId: string;
}

/** Monta o evento. Nao escreve nada — quem escreve e o chamador. */
export function buildSectionAbsence(context: SectionAbsenceContext): SectionAbsence {
  return {
    event: "section_absent",
    section: context.section,
    reason: context.reason,
    entityType: context.entityType,
    entityId: context.entityId,
    actionable: ACTIONABLE_REASONS.has(context.reason),
  };
}

/**
 * Serializa em UMA linha JSON para o coletor de logs do container.
 *
 * JSON e nao prosa porque a linha existe para ser filtrada
 * (`event=section_absent section=onde-assistir actionable=true`), nao lida uma
 * a uma.
 */
export function formatSectionAbsence(absence: SectionAbsence): string {
  return JSON.stringify(absence);
}

/**
 * O resultado de decidir se um bloco renderiza.
 *
 * A uniao e o ponto: `rendered: false` CARREGA o motivo. Nao existe estado
 * "nao renderizou e nao ha o que registrar".
 */
export type SectionDecision<T> =
  | { readonly rendered: true; readonly value: T; readonly absence: null }
  | { readonly rendered: false; readonly value: null; readonly absence: SectionAbsence };

/**
 * Decide um bloco a partir do dado que ele exibiria.
 *
 * `value` ausente (`null`/`undefined`) ou lista vazia => o bloco nao renderiza,
 * com o motivo dado. Lista vazia conta como ausencia de proposito: uma secao
 * com titulo e nenhum item e exatamente o "bloco editorial vazio" que o
 * contrato proibe.
 */
export function decideSection<T>(
  value: T | null | undefined,
  context: SectionAbsenceContext,
): SectionDecision<T> {
  const empty =
    value === null || value === undefined || (Array.isArray(value) && value.length === 0);

  if (empty) {
    return { rendered: false, value: null, absence: buildSectionAbsence(context) };
  }
  return { rendered: true, value: value as T, absence: null };
}
