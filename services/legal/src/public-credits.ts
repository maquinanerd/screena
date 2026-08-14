/**
 * public-credits.ts — A PROJECAO PUBLICA dos creditos de fonte.
 *
 * ============================================================================
 * POR QUE ESTE MODULO EXISTE
 * ============================================================================
 * Decisao do proprietario (Pablo Eduardo, 2026-08-13): todo credito de fonte sai
 * do corpo das paginas e passa a viver no RODAPE GLOBAL. O requisito nao
 * desapareceu — mudou de endereco. Antes: "o credito renderiza junto do dado".
 * Agora: "o credito renderiza no rodape, e o rodape esta na pagina".
 *
 * O risco dessa mudanca e obvio e e o motivo deste arquivo: se o rodape
 * carregasse strings literais, uma fonte nova registrada aqui em
 * `authorization-spec.ts` entraria no ar SEM credito, em silencio, e ninguem
 * perceberia ate a fonte reclamar. Entao o rodape NAO pode conhecer nomes de
 * fonte: ele le esta projecao, e esta projecao e derivada, de forma TOTAL, da
 * mesma declaracao que materializa `source_licenses`.
 *
 * Consequencia que e o contrato deste modulo (e esta travada por teste):
 *   registrar uma fonte em `authorization-spec.ts` faz o credito dela aparecer
 *   no rodape SEM ninguem editar o rodape.
 *
 * ============================================================================
 * O QUE ESTE MODULO NAO FAZ
 * ============================================================================
 *  - NAO reescreve texto de atribuicao. `attributionText` sai verbatim da
 *    licenca; e a letra da licenca, nao copy editorial. Um `.trim()` e o unico
 *    toque permitido.
 *  - NAO decide licenca, nao promove dado, nao liga `display_allowed`.
 *  - NAO libera logo. `logoAllowed` e o literal `false` no TIPO de
 *    `LicenseTarget` — o credito publico e SEMPRE textual, nunca marca grafica.
 *    Por isso `PublicSourceCredit` nao tem campo de logo: nao ha o que renderizar.
 *  - NAO faz IO. Puro, deterministico, sem `Date`/rede/DB — pode ser importado
 *    pelo render publico (invariantes 3 e 4).
 *
 * ============================================================================
 * O CRITERIO E "AUTORIZADA A EXIBIR", NAO "EXISTE NO SPEC"
 * ============================================================================
 * A projecao inclui toda licenca com `displayAllowed`. Uma fonte cuja EXIBICAO
 * foi revogada (`displayAllowed: false`) nao e creditada — creditar quem nao
 * pode aparecer seria afirmacao publica sem lastro.
 *
 * O criterio e deliberadamente esse, e nao "tem dado no ar hoje":
 *
 *   - Um criterio de DADO seria dinamico e o rodape nao tem acesso a ele (o
 *     layout raiz nao le banco). Pior: uma fonte autorizada que acabou de
 *     receber a primeira linha ficaria sem credito ate alguem perceber.
 *   - Um criterio de LICENCA e estatico, derivavel e conservador na direcao
 *     certa: o que pode aparecer, aparece creditado. Se a licenca autoriza e o
 *     dado ainda nao chegou, sobra credito (ruido). Se o dado chega, o credito
 *     ja esta la.
 *
 * ATENCAO ao mexer neste filtro: `movie-of-the-night` tem `displayAllowed:false`
 * na entrada estatica (a exibicao de OFERTA e gated por provedor canonico) e so
 * chega ao rodape por `STREAMING_ORIGIN_CREDITS`. Estreitar o filtro sem olhar
 * as origens apagaria o credito do agregador de streaming.
 */

import {
  STATIC_AUTHORIZATION,
  STREAMING_ORIGIN_CREDITS,
  type AuthorizationEntry,
  type SourceRole,
} from "./authorization-spec.js";

/**
 * O papel de uma fonte, em pt-BR, para a superficie publica.
 *
 * O mapa e TOTAL sobre `SourceRole`: um papel novo nao compila sem alguem
 * decidir como ele se descreve ao leitor. Isso e de proposito — inventar um
 * rotulo generico ("Fonte de dados") seria a mesma classe de defeito que este
 * modulo existe para impedir.
 */
const ROLE_LABELS: Readonly<Record<SourceRole, string>> = {
  "editorial-rating-source": "Notas",
  "catalog-provider": "Catálogo, elenco, imagens e ficha técnica",
  "streaming-aggregator": "Disponibilidade (onde assistir)",
};

/** Um credito pronto para a superficie publica. Textual, nunca logo. */
export interface PublicSourceCredit {
  /**
   * Chave estavel para `key`/`data-attr`. Deriva do texto de atribuicao, nao do
   * `sourceKey`: duas licencas do mesmo slug (ex.: TMDB metadados e TMDB
   * imagens) compartilham o mesmo credito e devem colapsar em UMA linha.
   */
  readonly creditKey: string;
  /** `attributionText` VERBATIM da licenca. Nunca reescrito. */
  readonly text: string;
  /** O que essa fonte alimenta, em pt-BR. */
  readonly roleLabel: string;
  /** Papel cru, para teste e `data-attr`. */
  readonly role: SourceRole;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Chave estavel a partir do texto do credito. Minusculas + nao-alfanumerico
 * colapsado em `-`. Deterministica e sem `Intl`.
 *
 * `NFD` separa o acento da letra e o filtro `[^a-z0-9]` descarta a marca
 * combinante junto com a pontuacao — entao NAO existe classe de caractere
 * combinante escrita neste arquivo. E de proposito: um literal desses viaja mal
 * entre encodings, e aqui ele seria puramente redundante.
 */
function creditKeyOf(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Todos os creditos publicos devidos, deduplicados por TEXTO.
 *
 * Duas fontes de entrada, porque a autorizacao tem duas formas:
 *  1. `STATIC_AUTHORIZATION` — TMDB, as cinco fontes de nota, e o agregador.
 *  2. `STREAMING_ORIGIN_CREDITS` — os fornecedores tecnicos de oferta
 *     (Movie of the Night e JustWatch). Eles NAO estao na lista estatica porque
 *     as licencas deles nascem por PROVEDOR CANONICO, dinamicamente, a partir do
 *     que existe em `watch_providers`. Sem incluir as origens aqui, o JustWatch
 *     — cujo credito o TMDB exige nominalmente, sob pena de revogar o acesso a
 *     API que sustenta o catalogo inteiro — nunca apareceria no rodape enquanto
 *     nenhum provedor estivesse registrado.
 *
 * Ordem: estavel e declarada (ordem de declaracao do spec, origens depois).
 * Duas replicas do site nunca mostram o rodape em ordem diferente.
 */
export function publicSourceCredits(
  entries: readonly AuthorizationEntry[] = STATIC_AUTHORIZATION,
  origins: readonly { readonly attributionText: string }[] = STREAMING_ORIGIN_CREDITS,
): readonly PublicSourceCredit[] {
  const out: PublicSourceCredit[] = [];
  const seen = new Set<string>();

  const push = (rawText: string, role: SourceRole): void => {
    const text = trimToNull(rawText);
    // Licenca sem texto de atribuicao nao rende credito silencioso: ela
    // simplesmente nao tem o que creditar. `requiresAttribution` e `true` no
    // TIPO, entao isto so alcanca uma string vazia — e uma string vazia no
    // rodape seria pior que a ausencia, porque pareceria um credito.
    if (text === null) return;
    const creditKey = creditKeyOf(text);
    if (seen.has(creditKey)) return;
    seen.add(creditKey);
    out.push({ creditKey, text, roleLabel: ROLE_LABELS[role], role });
  };

  for (const entry of entries) {
    // Licenca sem autorizacao de EXIBICAO nao rende credito publico: nao ha o
    // que creditar numa fonte que nao pode aparecer. Ver o cabecalho — e por
    // isto que `movie-of-the-night` depende de `origins` para chegar ao rodape.
    if (!entry.license.displayAllowed) continue;
    push(entry.license.attributionText, entry.role);
  }
  for (const origin of origins) push(origin.attributionText, "streaming-aggregator");

  return out;
}

/**
 * O disclaimer de nao-endosso do TMDB, extraido da PROPRIA licenca.
 *
 * Ele e exigencia dos termos da API e nao pode ser parafraseado. Fica separado
 * do resto porque tem posicao propria no rodape (a nota de rodape, junto do
 * copyright) e porque a ausencia dele e um defeito diferente da ausencia de um
 * credito qualquer: sem ele, o acesso a API do TMDB — que sustenta o catalogo
 * inteiro — fica em risco.
 *
 * Lanca se a licenca do TMDB sumir do spec. FAIL-CLOSED de proposito: um rodape
 * que renderiza sem o disclaimer e pior que um build que nao passa.
 */
export function tmdbNonEndorsementDisclaimer(
  entries: readonly AuthorizationEntry[] = STATIC_AUTHORIZATION,
): string {
  for (const entry of entries) {
    if (entry.license.sourceKey !== "tmdb") continue;
    const text = trimToNull(entry.license.attributionText);
    if (text !== null) return text;
  }
  throw new Error(
    "public-credits: licenca do TMDB ausente ou sem attributionText em authorization-spec.ts. " +
      "O disclaimer de nao-endosso e exigencia dos termos da API do TMDB e nao pode ser omitido nem reescrito.",
  );
}
