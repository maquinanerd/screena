/**
 * public-credits.ts — A PROJECAO PUBLICA dos creditos de fonte — e das MARCAS
 * que as licencas declaram.
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
 * AS MARCAS (2026-09-11)
 * ============================================================================
 * Ordem expressa do proprietario, 2026-09-11: "inclua OBRIGATORIAMENTE AS
 * LOGOS dos servicos de stream e dos sites de notas". A permissao ja existia
 * desde 2026-08-20 (`OWNER_DECISION_2026_08_20`); faltavam os ARQUIVOS. Com
 * eles no repositorio, as superficies que exibem nota e oferta passam a pedir a
 * marca a ESTE modulo — pela mesma regra do rodape: o componente nao conhece
 * caminho de logo nenhum, so repassa o que a licenca declara.
 *
 *  - `publicRatingSourceMark`  — a marca de uma fonte de nota (slot do chip);
 *  - `publicRatingStateIcon`   — o icone de ESTADO derivado do valor (o tomate
 *                                Fresh so com Tomatometer >= 60%), que nunca
 *                                ocupa o slot da marca;
 *  - `publicWatchProviderLogo` — o logo de um provedor canonico de streaming,
 *                                lido da MESMA funcao que gera a licenca dele;
 *  - `publicTrademarkNotices`  — as condicoes de marca que a fonte impoe (a
 *                                declaracao de marca registrada do IMDb), que o
 *                                rodape imprime em toda pagina.
 *
 * ============================================================================
 * O QUE ESTE MODULO NAO FAZ
 * ============================================================================
 *  - NAO reescreve texto de atribuicao. `attributionText` sai verbatim da
 *    licenca; e a letra da licenca, nao copy editorial. Um `.trim()` e o unico
 *    toque permitido.
 *  - NAO decide licenca, nao promove dado, nao liga `display_allowed`.
 *  - NAO decide logo. A projecao CARREGA o logo quando a licenca o autoriza E o
 *    arquivo oficial esta presente, e so entao. Quem autoriza e
 *    `authorization-spec.ts`.
 *  - O logo NUNCA substitui o credito. `PublicSourceCredit.text` continua
 *    obrigatorio e `logo` e opcional ao lado dele — os termos do TMDB pedem os
 *    DOIS (marca E disclaimer de nao-endosso), e um credito que virasse so
 *    imagem sumiria para leitor de tela e para quem bloqueia imagem.
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
  RATING_STATE_ICONS,
  STATIC_AUTHORIZATION,
  STREAMING_ORIGIN_CREDITS,
  streamingProviderEntries,
  type AuthorizationEntry,
  type LicenseLogoAsset,
  type LicenseTarget,
  type RatingStateIconAsset,
  type SourceRole,
  type StreamingOriginCredit,
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
  /**
   * A marca grafica, quando a licenca a autoriza E o arquivo oficial existe.
   *
   * `null` cobre DOIS estados que o consumidor precisa distinguir, e por isso
   * `logoPending` existe ao lado:
   *   - a fonte nao autoriza logo;
   *   - a fonte autoriza/EXIGE o logo mas o arquivo oficial ainda nao esta no
   *     repositorio. Nesse caso o credito sai textual e a ausencia e LOGADA.
   */
  readonly logo: PublicCreditLogo | null;
  /**
   * `true` quando a licenca autoriza/exige o logo mas o arquivo oficial falta.
   *
   * E a diferenca entre "nao ha o que renderizar" e "ha uma obrigacao pendente".
   * Sem este campo as duas seriam o mesmo `null` — ausencia muda, que e
   * exatamente o defeito que `section-absence.ts` existe para impedir.
   */
  readonly logoPending: boolean;
}

/** O arquivo de marca pronto para a superficie publica. */
export interface PublicCreditLogo {
  readonly src: string;
  readonly alt: string;
  /** Altura de exibicao DECLARADA pela licenca (`displayHeightPx`). */
  readonly heightPx: number;
  /**
   * Largura na altura declarada, derivada da proporcao INTRINSECA do arquivo
   * (`intrinsicSize`). Vai no atributo `width` do `<img>` para o navegador
   * reservar o espaco antes do download — sem ela, o logo que chega depois
   * empurra os vizinhos (CLS). `null` quando a licenca nao declara dimensoes.
   */
  readonly widthPx: number | null;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Largura na altura dada, pela proporcao do arquivo. `null` sem dimensoes. */
function widthAt(
  heightPx: number,
  size: { readonly width: number; readonly height: number } | null,
): number | null {
  if (size === null || size.height <= 0 || size.width <= 0) return null;
  return Math.round((heightPx * size.width) / size.height);
}

/** Projeta um asset de marca DECLARADO para a forma publica. */
function logoOf(asset: LicenseLogoAsset): PublicCreditLogo {
  return {
    src: asset.path,
    alt: asset.alt,
    heightPx: asset.displayHeightPx,
    widthPx: widthAt(asset.displayHeightPx, asset.intrinsicSize),
  };
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
  origins: readonly StreamingOriginCredit[] = STREAMING_ORIGIN_CREDITS,
): readonly PublicSourceCredit[] {
  const out: PublicSourceCredit[] = [];
  const seen = new Set<string>();

  const push = (
    rawText: string,
    role: SourceRole,
    logoAllowed: boolean,
    asset: LicenseLogoAsset | null,
  ): void => {
    const text = trimToNull(rawText);
    // Licenca sem texto de atribuicao nao rende credito silencioso: ela
    // simplesmente nao tem o que creditar. `requiresAttribution` e `true` no
    // TIPO, entao isto so alcanca uma string vazia — e uma string vazia no
    // rodape seria pior que a ausencia, porque pareceria um credito.
    if (text === null) return;
    const creditKey = creditKeyOf(text);
    if (seen.has(creditKey)) return;
    seen.add(creditKey);

    // O logo so existe quando a licenca autoriza E o arquivo oficial esta
    // presente. As duas condicoes, sempre: `logoAllowed` sem arquivo e
    // obrigacao pendente (`logoPending`), nao permissao para desenhar algo.
    const autorizado = logoAllowed && asset !== null;
    const presente = autorizado && asset.status === "present";
    out.push({
      creditKey,
      text,
      roleLabel: ROLE_LABELS[role],
      role,
      logo: presente ? logoOf(asset) : null,
      logoPending: autorizado && !presente,
    });
  };

  for (const entry of entries) {
    // Licenca sem autorizacao de EXIBICAO nao rende credito publico: nao ha o
    // que creditar numa fonte que nao pode aparecer. Ver o cabecalho — e por
    // isto que `movie-of-the-night` depende de `origins` para chegar ao rodape.
    if (!entry.license.displayAllowed) continue;
    push(
      entry.license.attributionText,
      entry.role,
      entry.license.logoAllowed,
      entry.license.logoAsset,
    );
  }
  // Origens de streaming nao tem licenca estatica (nascem por provedor
  // canonico); a declaracao de marca delas vive na propria projecao de origem
  // (desde 2026-08-20 o JustWatch carrega logo por decisao do proprietario — a
  // atribuicao continua NOMINAL: o logo entra ao lado do texto, nunca no lugar).
  for (const origin of origins) {
    push(origin.attributionText, "streaming-aggregator", origin.logoAllowed, origin.logoAsset);
  }

  return out;
}

/**
 * As CONDICOES DE MARCA das fontes cujo logo esta no ar, deduplicadas.
 *
 * Hoje: a declaracao que o IMDb exige em QUALQUER material que exiba a marca
 * dele ("IMDb, IMDb.COM, and the IMDb logo are trademarks of IMDb.com, Inc. or
 * its affiliates."). A condicao mora na LICENCA (`displayConditions`) e so
 * entra aqui quando o logo daquela fonte esta `present` — condicao de marca que
 * nao esta no ar seria texto juridico sem objeto.
 *
 * O rodape imprime o resultado em toda pagina: e ele que satisfaz a condicao em
 * qualquer tela onde a marca aparecer (chip de nota, credito do rodape).
 */
export function publicTrademarkNotices(
  entries: readonly AuthorizationEntry[] = STATIC_AUTHORIZATION,
  origins: readonly StreamingOriginCredit[] = STREAMING_ORIGIN_CREDITS,
): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const collect = (logoAllowed: boolean, asset: LicenseLogoAsset | null): void => {
    if (!logoAllowed || asset === null || asset.status !== "present") return;
    for (const raw of asset.displayConditions) {
      const text = trimToNull(raw);
      if (text === null || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
  };
  for (const entry of entries) {
    if (!entry.license.displayAllowed) continue;
    collect(entry.license.logoAllowed, entry.license.logoAsset);
  }
  for (const origin of origins) collect(origin.logoAllowed, origin.logoAsset);
  return out;
}

/** A marca de uma FONTE DE NOTA, para o slot do chip. */
export interface PublicRatingSourceMark {
  /** O arquivo declarado e presente; `null` = o slot mostra o nome em texto. */
  readonly logo: PublicCreditLogo | null;
  /** A licenca autoriza a marca, mas o arquivo ainda nao esta no repositorio. */
  readonly logoPending: boolean;
}

/** A licenca de EXIBICAO de uma fonte de nota, ou `null`. */
function ratingLicenseOf(
  sourceKey: string,
  entries: readonly AuthorizationEntry[],
): LicenseTarget | null {
  const entry = entries.find(
    (candidate) =>
      candidate.license.contentType === "rating" &&
      candidate.license.ratingSourceKey === sourceKey &&
      candidate.license.displayAllowed,
  );
  return entry?.license ?? null;
}

/**
 * A marca grafica de uma fonte de nota, quando a licenca a autoriza E o arquivo
 * oficial esta presente.
 *
 * Fonte sem licenca de exibicao, sem marca autorizada ou com asset que nao e
 * palavra-marca devolve `logo: null` — e o chip mostra o nome em texto. Um
 * icone de estado NUNCA sai por aqui: ele afirma um resultado (ver
 * `publicRatingStateIcon`).
 */
export function publicRatingSourceMark(
  sourceKey: string,
  entries: readonly AuthorizationEntry[] = STATIC_AUTHORIZATION,
): PublicRatingSourceMark {
  const license = ratingLicenseOf(sourceKey, entries);
  if (license === null || !license.logoAllowed || license.logoAsset === null) {
    return { logo: null, logoPending: false };
  }
  const asset = license.logoAsset;
  if (asset.kind !== "wordmark") return { logo: null, logoPending: false };
  if (asset.status !== "present") return { logo: null, logoPending: true };
  return { logo: logoOf(asset), logoPending: false };
}

/**
 * O icone de ESTADO de uma nota — DERIVADO DO VALOR, nunca fixo.
 *
 * Hoje so existe o tomate Fresh do Tomatometer (Rotten Tomatoes, critica), que
 * o titular vincula a faixa >= 60%. Abaixo disso o estado e Rotten, cujo
 * arquivo (Rotten Splat) ainda nao esta no repositorio: a nota sai SEM icone —
 * icone errado para a faixa seria pior que nenhum.
 *
 * Tres condicoes, todas obrigatorias: a licenca da fonte autoriza a marca
 * (icone de estado e marca do titular); o `scoreType` e o do icone (o tomate e
 * do Tomatometer, o Popcornmeter tem os proprios); e o valor cai na faixa.
 */
export function publicRatingStateIcon(
  sourceKey: string,
  scoreType: string,
  value: number,
  entries: readonly AuthorizationEntry[] = STATIC_AUTHORIZATION,
  icons: readonly RatingStateIconAsset[] = RATING_STATE_ICONS,
): PublicCreditLogo | null {
  if (!Number.isFinite(value)) return null;
  const license = ratingLicenseOf(sourceKey, entries);
  if (license === null || !license.logoAllowed) return null;
  const icon = icons.find(
    (candidate) =>
      candidate.ratingSource === sourceKey &&
      candidate.scoreType === scoreType &&
      value >= candidate.band.min &&
      value < candidate.band.maxExclusive,
  );
  if (icon === undefined || icon.status !== "present") return null;
  return {
    src: icon.path,
    alt: icon.state,
    heightPx: icon.displayHeightPx,
    widthPx: widthAt(icon.displayHeightPx, icon.intrinsicSize),
  };
}

/**
 * O logo de um PROVEDOR CANONICO de streaming (`watch_providers.slug`).
 *
 * Le a MESMA funcao que gera a licenca do provedor (`streamingProviderEntries`)
 * — nao um mapa paralelo. Se um dia a licenca de marca de um provedor mudar, a
 * tela acompanha sem ninguem lembrar de editar o painel.
 *
 * `name` e o nome exibido ao leitor; vira o `alt`. `null` quando o slug nao tem
 * arquivo presente (provedor recem-registrado) — a tela cai na palavra-marca.
 */
export function publicWatchProviderLogo(
  slug: string | null | undefined,
  name: string,
): PublicCreditLogo | null {
  if (typeof slug !== "string") return null;
  const key = slug.trim();
  if (key === "") return null;
  const [entry] = streamingProviderEntries([{ slug: key, canonicalName: name }]);
  if (entry === undefined) return null;
  const { logoAllowed, logoAsset } = entry.license;
  if (!logoAllowed || logoAsset === null || logoAsset.status !== "present") return null;
  return logoOf(logoAsset);
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
