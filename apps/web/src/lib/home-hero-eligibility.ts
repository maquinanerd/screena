/**
 * home-hero-eligibility.ts — QUEM PODE ser destaque da home. Módulo PURO.
 *
 * ============================================================================
 * O DEFEITO QUE ISTO FECHA
 * ============================================================================
 * O hero ordenava por **ano de lançamento decrescente** e não filtrava nada
 * além de "tem slug canônico pt-BR". O TMDB é comunitário e o lixo dele se
 * concentra justamente nas datas futuras, então a consulta entregava o pior
 * registro do catálogo com precisão cirúrgica: em 25/08/2026 o destaque da home
 * era "Der Liebesbrief", um curta alemão de 1938 cadastrado com
 * `release_date` em **2057**, sem pôster.
 *
 * Ordenar por data não é "quase certo": para esta faixa é *sistematicamente*
 * errado, porque premia exatamente o registro mais implausível.
 *
 * ============================================================================
 * PRECEDENTE QUE ESTE MÓDULO GENERALIZA
 * ============================================================================
 * O piso de votos já existia no repositório — na aba "Clássicos"
 * (`server/popular-rankings.ts`, `CLASSIC_MIN_VOTES`), com o raciocínio inteiro
 * escrito: sem ele, o recorte viraria "os filmes antigos mais obscuros do
 * catálogo". Mesmo defeito, mesma cura — resolvida uma vez, num lugar só. Aqui
 * ela vira regra compartilhada.
 *
 * Herdada dali, a regra de governança que vale também neste módulo:
 * `vote_count_tmdb` é sinal TÉCNICO do fornecedor e entra como critério de
 * CORTE/ORDENAÇÃO — **nunca** aparece na tela, não vira badge, não vira nota,
 * não vira fonte (invariantes 1 e 2).
 *
 * ============================================================================
 * SOBRE `adult`
 * ============================================================================
 * O portão pedia `adult = false`. Essa coluna **não existe** em `movies` nem em
 * `tv_shows` — e não é esquecimento: a exclusão de conteúdo adulto acontece na
 * DESCOBERTA, em duas camadas fail-closed (arquivos `adult_*` nunca baixados +
 * campo `adult` classificado por linha), documentadas em
 * `.claude/rules/ingestion.md`. Um título adulto não chega a existir no
 * catálogo, então não há o que filtrar aqui. Inventar uma coluna para repetir a
 * checagem daria a impressão de uma segunda barreira que na verdade estaria
 * lendo um campo que ninguém preenche — pior que não ter.
 */

/** Piso de votos do HERO. Mais duro que o de listagem: hero é vitrine. */
export const HERO_MIN_VOTE_COUNT = 200;

/** Primeiro ano plausível de cinema (a exibição dos Lumière é de 1895). */
export const HERO_MIN_YEAR = 1888;

/**
 * Quantos anos à frente do ano corrente uma data ainda é plausível.
 *
 * Anúncio legítimo de estreia distante existe (sequência datada com 2–3 anos de
 * antecedência); 2057 é erro de cadastro. O corte separa os dois.
 */
export const HERO_MAX_YEARS_AHEAD = 3;

/** Status TMDB de filme já lançado. */
export const HERO_MOVIE_RELEASED_STATUS = "Released";

/** Por que um candidato NÃO pode ser destaque. Cada motivo é observável. */
export type HeroRejectionReason =
  | "sem_backdrop"
  | "sem_poster"
  | "votos_insuficientes"
  | "sem_sinopse_pt_br"
  | "estreia_futura"
  | "nao_lancado"
  | "ano_implausivel";

/** Os fatos de um candidato que o portão examina. */
export interface HeroCandidateFacts {
  readonly kind: "movie" | "series";
  /** `file_path` cru do backdrop 16:9, ou null. */
  readonly backdropPath: string | null;
  /** `file_path` cru do pôster, ou null. */
  readonly posterPath: string | null;
  /** `vote_count_tmdb`. Critério de corte — nunca exibido. */
  readonly voteCount: number | null;
  /** Sinopse pt-BR (`entity_translations.summary`). */
  readonly summary: string | null;
  /** `release_date` (filme) ou `first_air_date` (série). */
  readonly releaseDate: Date | null;
  /** `status` do TMDB. Só decide para filme. */
  readonly status: string | null;
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === "";
}

/**
 * O motivo da recusa, ou `null` se o candidato passa.
 *
 * FAIL-CLOSED: dado ausente reprova. Um candidato sem `release_date` não tem
 * como provar que já estreou, e o hero não é lugar para dúvida — a listagem e o
 * trilho "Em breve" continuam mostrando o título normalmente.
 *
 * A ordem das checagens é a ordem do diagnóstico, não da lógica: a primeira que
 * falha é a que o log reporta, então as mais baratas e mais frequentes
 * (ausência de arte) vêm antes.
 */
export function heroRejectionReason(
  facts: HeroCandidateFacts,
  now: Date,
): HeroRejectionReason | null {
  if (isBlank(facts.backdropPath)) return "sem_backdrop";
  if (isBlank(facts.posterPath)) return "sem_poster";
  if (facts.voteCount === null || facts.voteCount < HERO_MIN_VOTE_COUNT) {
    return "votos_insuficientes";
  }
  if (isBlank(facts.summary)) return "sem_sinopse_pt_br";

  // Sem data não há como afirmar que estreou: fail-closed.
  if (facts.releaseDate === null) return "estreia_futura";

  const ano = facts.releaseDate.getUTCFullYear();
  if (ano < HERO_MIN_YEAR || ano > now.getUTCFullYear() + HERO_MAX_YEARS_AHEAD) {
    return "ano_implausivel";
  }
  if (facts.releaseDate.getTime() > now.getTime()) return "estreia_futura";

  // `status` só decide para filme: em série "Returning Series"/"Ended" são
  // ambos legítimos, e exigir "Released" (que não é status de série) reprovaria
  // o catálogo inteiro de séries.
  if (facts.kind === "movie" && facts.status !== HERO_MOVIE_RELEASED_STATUS) {
    return "nao_lancado";
  }
  return null;
}

/** Açúcar booleano sobre `heroRejectionReason`. */
export function isHeroEligible(facts: HeroCandidateFacts, now: Date): boolean {
  return heroRejectionReason(facts, now) === null;
}
