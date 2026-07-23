/**
 * Elegibilidade de PESSOA para exposicao publica.
 *
 * PROBLEMA QUE ESTA REGRA RESOLVE
 * -------------------------------
 * Ate aqui, qualquer linha de `people` com slug canonico e nome nao vazio virava
 * pagina publica e entrada de sitemap. Como a ingestao de um filme/serie traz o
 * elenco e a equipe inteiros (`append_to_response=credits`), cada titulo
 * sincronizado despejava dezenas de pessoas no catalogo — inclusive figurantes,
 * assistentes e stubs de credito sem nenhuma obra publicavel associada.
 *
 * O efeito observado foi um sitemap dominado por pessoas: ~22.400 URLs de pessoa
 * contra ~129 filmes e ~110 series. Isso nao e "indexacao total" — e diluicao.
 * A invariante 5 manda indexar a ENTIDADE SINCRONIZADA; ela nao obriga a
 * publicar um registro que existe apenas como efeito colateral do elenco de
 * outra entidade e que nao sustenta uma pagina com valor proprio.
 *
 * A REGRA
 * -------
 * Uma pessoa e elegivel a exposicao publica quando, cumulativamente:
 *
 *  1. tem NOME nao vazio (sem nome nao ha titulo, nem H1, nem schema `Person`);
 *  2. tem SLUG canonico no idioma (sem slug nao ha rota — e caso tecnico);
 *  3. tem PELO MENOS UM credito (elenco ou equipe) em uma obra PUBLICAVEL
 *     (filme ou serie que ela propria passa nos gates de publicacao).
 *
 * O criterio (3) e o que muda o jogo: a pessoa so aparece se houver, no proprio
 * catalogo, uma obra publicada que justifique a pagina. Credito em episodio NAO
 * conta sozinho — o episodio pertence a uma serie, e e a serie que sustenta a
 * relevancia editorial da pessoa.
 *
 * O QUE ESTA REGRA NAO E
 * ----------------------
 * Nao e gate de licenca (invariante 6 continua valendo, avaliada em separado),
 * nao e gate de idioma (`PUBLISHED_LOCALES`, invariante 7) e nao decide
 * `index`/`noindex` sozinha. Ela responde a uma pergunta anterior: "esta pessoa
 * deveria sequer ter pagina publica?".
 *
 * MODULO PURO: sem banco, sem rede, sem IO. A consulta que conta os creditos
 * publicaveis vive na fronteira (SQL do sitemap / loaders / censo) e DEVE usar o
 * mesmo criterio expresso aqui — ver `PERSON_ELIGIBILITY_CONTRACT`.
 */

/** Numero minimo de creditos em obra publicavel para a pessoa ser elegivel. */
export const MIN_PUBLISHABLE_CREDITS = 1;

/** Motivo pelo qual uma pessoa NAO e elegivel (null quando elegivel). */
export type PersonIneligibilityReason =
  | "name_missing"
  | "slug_missing"
  | "no_publishable_credit";

/** Entrada da avaliacao: fatos ja apurados sobre a pessoa. */
export interface PersonEligibilityInput {
  /** Nome da pessoa (`people.name`). */
  readonly name: string;
  /** Existe slug canonico para a pessoa no idioma avaliado? */
  readonly hasCanonicalSlug: boolean;
  /**
   * Quantos creditos (cast + crew) a pessoa tem em obras PUBLICAVEIS
   * (filme/serie que passam nos gates). Creditos em episodio nao entram.
   */
  readonly publishableCreditCount: number;
}

/** Decisao de elegibilidade, com motivo auditavel. */
export interface PersonEligibilityDecision {
  readonly eligible: boolean;
  readonly reason: PersonIneligibilityReason | null;
  /** Explicacao em pt-BR, estavel o bastante para log e relatorio de censo. */
  readonly explanation: string;
}

/**
 * Avalia a elegibilidade de UMA pessoa. Precedencia do mais tecnico ao mais
 * editorial: sem nome -> sem slug -> sem credito publicavel.
 */
export function evaluatePersonEligibility(
  input: PersonEligibilityInput,
): PersonEligibilityDecision {
  if (input.name.trim() === "") {
    return {
      eligible: false,
      reason: "name_missing",
      explanation: "pessoa sem nome: nao sustenta titulo, H1 nem schema Person.",
    };
  }
  if (!input.hasCanonicalSlug) {
    return {
      eligible: false,
      reason: "slug_missing",
      explanation:
        "pessoa sem slug canonico no idioma: nao ha rota publica (caso tecnico).",
    };
  }
  if (input.publishableCreditCount < MIN_PUBLISHABLE_CREDITS) {
    return {
      eligible: false,
      reason: "no_publishable_credit",
      explanation:
        `pessoa sem credito em obra publicavel (minimo ${MIN_PUBLISHABLE_CREDITS}): ` +
        "stub de elenco importado junto de outra entidade, sem pagina propria justificada.",
    };
  }
  return {
    eligible: true,
    reason: null,
    explanation: `pessoa com ${input.publishableCreditCount} credito(s) em obra publicavel.`,
  };
}

/**
 * CONTRATO da regra para a fronteira (sitemap, loaders, censo) manter o mesmo
 * criterio do modulo puro. Nao e executado aqui: e declaracao normativa
 * verificada por teste, para que consulta e regra nao divirjam em silencio.
 *
 * Traduzido em SQL: existe pelo menos um credito (cast OU crew) da pessoa cujo
 * `entity_type` e 'movie' ou 'tv' e cuja obra tem slug canonico no MESMO idioma
 * e titulo nao vazio.
 */
export const PERSON_ELIGIBILITY_CONTRACT = Object.freeze({
  /** Tipos de obra que sustentam a relevancia editorial de uma pessoa. */
  creditEntityTypes: Object.freeze(["movie", "tv"] as const),
  /** Tabelas de credito consideradas. */
  creditTables: Object.freeze(["cast_members", "crew_members"] as const),
  minPublishableCredits: MIN_PUBLISHABLE_CREDITS,
});
