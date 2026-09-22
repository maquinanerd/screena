/**
 * entity-quality-gates.ts — os PORTOES DE QUALIDADE por tipo de pagina.
 *
 * DE ONDE VEM. A invariante 5 manda indexar toda entidade sincronizada, com
 * `noindex` so para caso tecnico. Em 11/09/2026 o dono decidiu por escrito
 * (`docs/seo/DECISOES-DO-DONO-2026-09-11.md`) tres recortes a essa regra, cada
 * um sustentado por MEDICAO da auditoria de SEO:
 *
 *   D1  galerias    69.016 URLs, 0 palavras de conteudo principal, sem <main>;
 *   D2  pessoas     73.574 perfis; 0 de 300 amostrados exibiam biografia;
 *   D3  tmdb-{id}   11.666 fichas sem titulo localizado nem descricao.
 *
 * O QUE UM PORTAO E, E O QUE NAO E. Nao e caso tecnico (a pagina e valida) e
 * nao e exclusao explicita (ninguem decidiu que a pagina e ruim para sempre). A
 * pagina existe, responde 200 e continua util para quem chega nela — ela so nao
 * e oferecida ao indice AINDA. Por isso o desfecho e `noindex, FOLLOW`: os links
 * dela continuam sustentando as paginas que indexam.
 *
 * UMA REGRA, DUAS TRADUCOES. Cada portao existe aqui como funcao pura (a pagina
 * usa) e como CONTRATO declarado (o SQL do sitemap usa). Se as duas divergirem, a
 * meta tag diz uma coisa e o sitemap outra — o defeito que a remediacao existe
 * para acabar. O validador real de PostgreSQL prova que concordam.
 *
 * O PORTAO SE ABRE SOZINHO. Nenhum depende de um humano rodar comando: a ficha
 * que ganha titulo em pt-BR, a pessoa que ganha foto e filmografia (ou biografia
 * liberada), passam a indexar na revalidacao seguinte e entram no sitemap pelo
 * mesmo motivo.
 *
 * MODULO PURO: sem banco, sem rede, sem IO, sem Date.
 */

import { evaluatePersonEligibility } from "./person-eligibility.js";

/** Qual portao produziu o veredito. */
export type QualityGateId = "gallery" | "person" | "localization" | "season" | "episode";

/** Veredito de um portao de qualidade. */
export interface QualityGateVerdict {
  readonly passed: boolean;
  readonly gate: QualityGateId;
  /** Codigo estavel, para log, censo e teste. */
  readonly code: string;
  /** Explicacao em pt-BR, estavel o bastante para ir ao `reason` da decisao. */
  readonly reason: string;
}

/** Diretivas de uma pagina barrada por portao de qualidade. */
export const QUALITY_GATE_ROBOTS = Object.freeze({ index: false, follow: true } as const);

function passed(gate: QualityGateId, code: string, reason: string): QualityGateVerdict {
  return { passed: true, gate, code, reason };
}

function failed(gate: QualityGateId, code: string, reason: string): QualityGateVerdict {
  return { passed: false, gate, code, reason };
}

// ---------------------------------------------------------------------------
// D1 — GALERIA
// ---------------------------------------------------------------------------

/**
 * D1: galeria de midia NUNCA indexa como pagina propria.
 *
 * Vale para `/imagens/`, `/videos/` e `/fotos/` de qualquer entidade. A pagina
 * continua acessivel e com `follow`. Quem descobre imagem e video e a ENTIDADE
 * dona (schema e extensao de sitemap dela), nao uma URL fina por midia.
 *
 * Nao recebe entrada, de proposito. Ate aqui cada galeria decidia pelo proprio
 * piso de quantidade — e a galeria de episodio chegou a indexar com o episodio
 * dono suspenso, porque o piso nao olhava o dono. Uma galeria que nunca indexa
 * nao consegue ser mais indexavel que o dono: o vazamento some por construcao.
 * Se esta decisao um dia for revertida, a nova regra precisa exigir o dono E o
 * piso — nao so o piso.
 */
export function evaluateGalleryGate(): QualityGateVerdict {
  return failed(
    "gallery",
    "gallery_not_indexable",
    "Galeria de midia nao indexa como pagina propria (decisao do dono D1, 2026-09-11): a pagina continua acessivel, e a entidade dona e quem se oferece ao indice.",
  );
}

// ---------------------------------------------------------------------------
// D3 — FICHA COM SLUG DE FALLBACK E SEM LOCALIZACAO
// ---------------------------------------------------------------------------

/**
 * Slug de FALLBACK da ingestao: `desiredCatalogSlug` devolve `tmdb-{id}` quando o
 * titulo nao produz slug (tipicamente alfabeto nao latino). O sufixo de
 * colisao `-tmdb-{id}` ("espaco-1999-tmdb-134") NAO casa — la o titulo produziu
 * slug, e o portao nao se aplica.
 */
export const TMDB_FALLBACK_SLUG_PATTERN = /^tmdb-\d+$/;

/** A MESMA regra, na sintaxe de regex do PostgreSQL (operador `~`). */
export const TMDB_FALLBACK_SLUG_SQL_PATTERN = "^tmdb-[0-9]+$";

/** Fatos que o portao de localizacao le. */
export interface LocalizationGateInput {
  /** Slug canonico da ficha no locale publicado. */
  readonly canonicalSlug: string;
  /** `entity_translations.title` da linha do locale publicado, como esta no banco. */
  readonly localizedTitle: string | null;
  /** `movies.title_original` / `tv_shows.name_original` — o titulo que veio do TMDB. */
  readonly originalTitle: string | null;
  /** Ha descricao nao vazia (`summary` ou `meta_description`) no locale publicado? */
  readonly hasLocalizedDescription: boolean;
}

/**
 * Um titulo conta como LOCALIZADO quando existe e e DIFERENTE do original.
 *
 * POR QUE A COMPARACAO EXISTE. Ate 17/09/2026 o portao aceitava qualquer titulo
 * nao vazio na linha do locale publicado — e, com o conserto no ar, MEDIU-SE em
 * producao que ele nao barrava ninguem: 11.922 fichas de slug `tmdb-N` (6.682
 * filmes e 5.240 series) continuavam no sitemap e com `index`, contra as ~11.666
 * que a D3 media. A amostra explicou: a linha pt-BR existe e carrega o titulo
 * ORIGINAL copiado (`Tipota`, em grego; `Tsuki no Tami`, em japones), e a pagina
 * so tem a description gerada a partir de fatos. Titulo copiado nao e traducao,
 * e a D3 fala de "titulo no alfabeto original e sem description".
 *
 * COMPARACAO EXATA, SO COM `trim`. Sem `lower`, sem normalizacao Unicode: o SQL
 * do sitemap tem de julgar IGUAL a pagina, e `lower()` do PostgreSQL depende do
 * collation do cluster enquanto o do JavaScript nao. Divergir aqui traria de
 * volta exatamente o defeito que a remediacao fechou (meta tag dizendo uma coisa,
 * sitemap outra). Um titulo que difere do original so por caixa ou por forma
 * Unicode segue contando como localizado: e o lado conservador — mantem no indice
 * em vez de tirar.
 *
 * DENTRO DO ESCOPO, IGUAL AO ORIGINAL SIGNIFICA ALFABETO ORIGINAL. O portao so
 * olha ficha com slug `tmdb-N`, e esse slug nasce justamente quando o titulo NAO
 * produz slug (alfabeto nao latino). Entao, aqui, "titulo igual ao original" e
 * sempre o caso que o dono decidiu tirar — e um titulo em pt-BR de verdade
 * continua abrindo o portao, mesmo com o slug antigo.
 */
export function isLocalizedTitle(
  localizedTitle: string | null,
  originalTitle: string | null,
): boolean {
  const localizado = (localizedTitle ?? "").trim();
  if (localizado === "") return false;
  return localizado !== (originalTitle ?? "").trim();
}

/**
 * D3: ficha com slug de fallback, SEM titulo localizado E SEM descricao, nao
 * indexa ate ser enriquecida.
 *
 * O slug restringe o ESCOPO ao que o dono decidiu; ele nao e a condicao. Uma
 * ficha que ganha titulo em pt-BR ou descricao passa a indexar mesmo que o slug
 * continue `tmdb-{id}` (slug e estavel; recanonizar e outro processo). Se a
 * condicao fosse so o slug, a ficha enriquecida ficaria fora do indice para
 * sempre.
 *
 * Basta UM dos dois — titulo OU descricao — para abrir: e a leitura menos
 * agressiva de "titulo nao localizado + sem description", que e uma conjuncao.
 * Titulo, porem, e o que `isLocalizedTitle` define: existir nao basta, precisa
 * ser diferente do original.
 */
export function evaluateLocalizationGate(input: LocalizationGateInput): QualityGateVerdict {
  if (!TMDB_FALLBACK_SLUG_PATTERN.test(input.canonicalSlug.trim())) {
    return passed(
      "localization",
      "readable_slug",
      "Slug derivado do titulo: o portao de localizacao nao se aplica.",
    );
  }
  if (isLocalizedTitle(input.localizedTitle, input.originalTitle) || input.hasLocalizedDescription) {
    return passed(
      "localization",
      "localized",
      "Ficha com slug de fallback, mas ja enriquecida no locale publicado (titulo diferente do original ou descricao).",
    );
  }
  return failed(
    "localization",
    "not_localized",
    "Ficha com slug de fallback tmdb-{id}, sem titulo localizado (ausente ou igual ao original) e sem descricao em pt-BR: nao indexa ate ser enriquecida (decisao do dono D3, 2026-09-11). Indexa sozinha quando ganhar titulo proprio ou descricao.",
  );
}

// ---------------------------------------------------------------------------
// TEMPORADA E EPISODIO — a saida da valvula de 2026-08-27, por DADO
// ---------------------------------------------------------------------------

/**
 * Sinopse "de verdade": pelo menos esta quantidade de caracteres, depois de
 * tirar espaco, tabulacao e quebra de linha das pontas.
 *
 * POR QUE UM PISO, E NAO SO "NAO VAZIA". A pagina de temporada e a de episodio
 * valem pelo TEXTO proprio; um "Episodio de estreia." de vinte caracteres nao
 * sustenta uma pagina no indice. Sessenta caracteres e uma frase curta — o piso
 * separa o texto do rotulo, sem julgar estilo.
 */
export const MIN_SYNOPSIS_CHARS = 60;

/**
 * Os caracteres que saem das pontas antes de medir a sinopse. O SQL passa a
 * MESMA lista como parametro de `BTRIM` — o `BTRIM` sem segundo argumento so
 * tira espaco, e o `trim` do JavaScript tira tudo que e branco. Com a lista
 * explicita, pagina e sitemap medem igual.
 */
export const SYNOPSIS_TRIM_CHARS = " \t\r\n";

/**
 * Quantos episodios com sinopse de verdade sustentam a pagina de uma temporada
 * que nao tem sinopse propria. Tres: a temporada vira um GUIA de episodios, e
 * nao a lista de "Episodio 1, Episodio 2..." que o TMDB devolve quando nao ha
 * traducao.
 */
export const MIN_SEASON_EPISODES_WITH_SYNOPSIS = 3;

/**
 * Tamanho da sinopse como o PostgreSQL mede (`char_length` conta pontos de
 * codigo, e o `length` do JavaScript conta unidades UTF-16), depois de tirar
 * `SYNOPSIS_TRIM_CHARS` das pontas.
 */
export function synopsisLength(text: string | null): number {
  if (text === null) return 0;
  let inicio = 0;
  let fim = text.length;
  while (inicio < fim && SYNOPSIS_TRIM_CHARS.includes(text.charAt(inicio))) inicio += 1;
  while (fim > inicio && SYNOPSIS_TRIM_CHARS.includes(text.charAt(fim - 1))) fim -= 1;
  return [...text.slice(inicio, fim)].length;
}

/** A sinopse chega ao piso de `MIN_SYNOPSIS_CHARS`? */
export function hasRealSynopsis(text: string | null): boolean {
  return synopsisLength(text) >= MIN_SYNOPSIS_CHARS;
}

/** Fatos que o portao de temporada le. */
export interface SeasonQualityGateInput {
  /**
   * A SERIE dona esta no indice: slug canonico, titulo original, portao de
   * localizacao (D3) e decisao efetiva `index` — o predicado do sitemap de
   * series. Temporada de serie fora do indice nao se sustenta sozinha.
   */
  readonly seriesInIndex: boolean;
  readonly seasonNumber: number;
  /** `seasons.overview`, como esta no banco. */
  readonly overview: string | null;
  /** Episodios LISTADOS pela temporada cuja sinopse chega ao piso. */
  readonly episodesWithSynopsis: number;
}

/**
 * Temporada indexa quando tem conteudo proprio: sinopse da temporada, OU um guia
 * de pelo menos `MIN_SEASON_EPISODES_WITH_SYNOPSIS` episodios com sinopse.
 *
 * DE ONDE VEM (22/09/2026). A valvula de 2026-08-27 suspendeu o TIPO inteiro e
 * registrou a propria saida: "quando a Fase 3 estiver aplicada, o gate volta a
 * perguntar pelo DADO". O dono pediu a saida em 22/09/2026 ("indexar so
 * temporada com conteudo de verdade"). Medido em producao no mesmo dia, em 40
 * temporadas sorteadas do catalogo: uma tinha sinopse propria; as outras valiam
 * pela lista de episodios — de "Episodio 1..394" sem texto (1.343 palavras de
 * rotulo) a guias completos de 54 episodios com sinopse.
 */
export function evaluateSeasonQualityGate(input: SeasonQualityGateInput): QualityGateVerdict {
  if (!input.seriesInIndex) {
    return failed(
      "season",
      "series_not_in_index",
      "Temporada de serie fora do indice: a pagina herda a exclusao da serie dona.",
    );
  }
  if (!Number.isInteger(input.seasonNumber) || input.seasonNumber < 1) {
    return failed(
      "season",
      "invalid_season_number",
      "Temporada sem numero valido (especiais sao a temporada 0): nao ha rota publica.",
    );
  }
  if (hasRealSynopsis(input.overview)) {
    return passed("season", "season_overview", "Temporada com sinopse propria.");
  }
  if (input.episodesWithSynopsis >= MIN_SEASON_EPISODES_WITH_SYNOPSIS) {
    return passed(
      "season",
      "episode_guide",
      `Temporada sem sinopse propria, com ${input.episodesWithSynopsis} episodios com sinopse: a pagina e um guia de episodios.`,
    );
  }
  return failed(
    "season",
    "no_season_content",
    `Temporada sem sinopse propria e com ${input.episodesWithSynopsis} episodio(s) com sinopse (minimo ${MIN_SEASON_EPISODES_WITH_SYNOPSIS}): a pagina e so a lista de numeros de episodio. Indexa sozinha quando a traducao chegar.`,
  );
}

/** Fatos que o portao de episodio le. */
export interface EpisodeQualityGateInput {
  /** Ver `SeasonQualityGateInput.seriesInIndex`. */
  readonly seriesInIndex: boolean;
  /** `episodes.overview`, como esta no banco. */
  readonly overview: string | null;
  /** `episodes.still_path`: a imagem PROPRIA do episodio. */
  readonly stillPath: string | null;
}

/**
 * Episodio indexa quando tem sinopse de verdade E imagem propria.
 *
 * Medido em producao em 22/09/2026, em 38 episodios sorteados: 33 se chamavam
 * "Episodio N", sem sinopse, com 23 a 56 palavras na pagina; os 5 com sinopse em
 * pt-BR tinham titulo proprio e de 78 a 154 palavras. A sinopse e o que
 * distingue a pagina de casca; a imagem e o que o dono pediu para a pagina de
 * episodio ("imagem dos episodios") e o que o `TVEpisode` do schema carrega.
 *
 * Credito de equipe NAO entra: nenhum dos 38 tinha direcao registrada, e exigir
 * isso deixaria de fora os episodios com texto e imagem de verdade.
 */
export function evaluateEpisodeQualityGate(input: EpisodeQualityGateInput): QualityGateVerdict {
  if (!input.seriesInIndex) {
    return failed(
      "episode",
      "series_not_in_index",
      "Episodio de serie fora do indice: a pagina herda a exclusao da serie dona.",
    );
  }
  if (!hasRealSynopsis(input.overview)) {
    return failed(
      "episode",
      "no_episode_synopsis",
      `Episodio sem sinopse de pelo menos ${MIN_SYNOPSIS_CHARS} caracteres: a pagina e titulo, numero e data. Indexa sozinho quando a sinopse chegar.`,
    );
  }
  if (input.stillPath === null || input.stillPath.trim() === "") {
    return failed(
      "episode",
      "no_episode_still",
      "Episodio sem imagem propria: a pagina nao tem a cena que a ficha de episodio promete.",
    );
  }
  return passed("episode", "eligible", "Episodio com sinopse e imagem proprias.");
}

// ---------------------------------------------------------------------------
// D2 — PESSOA
// ---------------------------------------------------------------------------

/**
 * Status de `people.biography_source_status` que liberam a biografia para
 * EXIBICAO (invariante 6). A coluna nasce `unknown`; texto ingerido sem
 * liberacao nao aparece na tela, e portanto nao pode sustentar indexacao.
 */
export const DISPLAYABLE_BIOGRAPHY_SOURCE_STATUSES = Object.freeze([
  "official",
  "licensed",
  "third_party",
] as const);

/**
 * Quantas OBRAS no indice sustentam, sozinhas, a pagina de uma pessoa que nao
 * tem biografia exibivel.
 *
 * POR QUE EXISTE (22/09/2026). A D2 pede "biografia/conteudo licenciado
 * suficiente" e "filmografia/relevancia". A primeira implementacao leu so
 * "biografia" — e `biography_source_status` nasce `unknown` e nada no repositorio
 * o altera, porque libera-lo e decisao de licenca (humana). Resultado medido em
 * producao em 22/09/2026: o portao barrava TODAS as pessoas. As 50 pessoas
 * alcancaveis a partir de 40 fichas sorteadas do sitemap estavam `noindex` —
 * Josh Brolin (60 obras), Scarlett Johansson (73), Ewan McGregor (69), Steven
 * Soderbergh (77) entre elas —, e o sitemap tinha zero URL de pessoa.
 *
 * A filmografia E conteudo licenciado: sao os creditos do TMDB, exibidos sob a
 * mesma licenca que a ficha da obra usa. E e ela que responde a busca por uma
 * pessoa ("filmes com fulano") — algo que a pagina da obra, que so lista o
 * proprio elenco, nao responde.
 *
 * POR QUE CINCO. Na mesma amostra, as 45 pessoas com foto tinham de 5 a 143
 * obras, e a pagina rendia de 52 a 933 palavras dentro de `<main>`; as 5 sem
 * foto tinham de 1 a 5 obras e de 22 a 84 palavras. A foto e o que separa o
 * perfil real do stub de elenco, e cinco obras e o piso em que a pagina deixa de
 * repetir a lista de elenco de uma ou duas fichas: ela passa a AGREGAR o que so
 * existe espalhado por varias. O corte nao descartou ninguem da amostra que
 * tivesse foto — o menor com foto tinha exatamente cinco.
 */
export const MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY = 5;

/** Fatos que o portao de pessoa le. */
export interface PersonQualityGateInput {
  readonly name: string;
  readonly hasCanonicalSlug: boolean;
  readonly biography: string | null;
  readonly biographySourceStatus: string | null;
  readonly profilePath: string | null;
  /**
   * OBRAS distintas — filme ou serie — em que a pessoa tem credito (elenco ou
   * equipe) e que estao, elas proprias, no indice: slug canonico no locale,
   * titulo original, portao de localizacao (D3) e decisao efetiva `index`. E o
   * predicado que poe a obra no sitemap, repetido no SQL de pessoa.
   *
   * Conta OBRA, nao linha de credito: quem dirige e roteiriza o mesmo filme soma
   * uma. E so obra no indice: uma filmografia feita de fichas que o proprio site
   * tira do indice (titulo no alfabeto original, sem traducao) nao sustenta a
   * pagina da pessoa para o leitor em pt-BR.
   */
  readonly indexableWorkCount: number;
}

/**
 * A biografia vai para a tela? Texto nao vazio E status que libera exibicao
 * (invariante 6). Exportada porque a pagina e o SQL do sitemap precisam do MESMO
 * criterio para escolher o piso de obras.
 */
export function isDisplayableBiography(biography: string | null, status: string | null): boolean {
  if (biography === null || biography.trim() === "") return false;
  return (DISPLAYABLE_BIOGRAPHY_SOURCE_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * Quantas obras no indice a pessoa precisa ter: uma, quando a biografia vai para
 * a tela (o texto e o conteudo proprio); `MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY`,
 * quando a pagina se sustenta so pela filmografia.
 */
export function requiredIndexableWorks(hasDisplayableBiography: boolean): number {
  return hasDisplayableBiography ? 1 : MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY;
}

/**
 * D2: pessoa indexa so com material suficiente para sustentar a pagina.
 *
 * A forma declarada pelo dono e "foto valida + identificacao confiavel +
 * biografia/conteudo licenciado suficiente + filmografia/relevancia + dados
 * minimos de entidade". Traduzida, na ordem do mais tecnico ao mais editorial:
 *
 *  1. nome e slug canonico (identificacao e dados minimos);
 *  2. foto;
 *  3. ao menos uma obra no indice (a regra de elegibilidade que ja existia);
 *  4. conteudo proprio suficiente: biografia exibivel, OU uma filmografia de
 *     `MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY` obras no indice.
 *
 * O SQL do sitemap aplica o mesmo portao (`sitemap-index.ts`), e o produtor do
 * censo aplica uma versao que nunca e mais restritiva que esta
 * (`catalog-indexability.ts`) — a decisao persistida mais restritiva venceria a
 * pagina.
 */
export function evaluatePersonQualityGate(input: PersonQualityGateInput): QualityGateVerdict {
  const elegibilidade = evaluatePersonEligibility({
    name: input.name,
    hasCanonicalSlug: input.hasCanonicalSlug,
    publishableCreditCount: input.indexableWorkCount,
  });
  // Nome e slug primeiro: sem eles nao ha pagina para avaliar.
  if (
    !elegibilidade.eligible &&
    (elegibilidade.reason === "name_missing" || elegibilidade.reason === "slug_missing")
  ) {
    return failed("person", elegibilidade.reason, elegibilidade.explanation);
  }
  if (input.profilePath === null || input.profilePath.trim() === "") {
    return failed(
      "person",
      "no_profile_photo",
      "Pessoa sem foto de perfil: a ficha nao sustenta pagina propria no indice (decisao do dono D2, 2026-09-11).",
    );
  }
  if (!elegibilidade.eligible) {
    return failed("person", elegibilidade.reason ?? "no_publishable_credit", elegibilidade.explanation);
  }
  const comBiografia = isDisplayableBiography(input.biography, input.biographySourceStatus);
  const piso = requiredIndexableWorks(comBiografia);
  if (input.indexableWorkCount < piso) {
    return failed(
      "person",
      "short_filmography",
      `Pessoa sem biografia exibivel e com ${input.indexableWorkCount} obra(s) no indice, abaixo do minimo de ${piso}: a ficha repete o elenco de poucas obras e nao sustenta pagina propria no indice (decisao do dono D2, 2026-09-11). Indexa sozinha quando a filmografia chegar ao minimo ou a biografia for liberada.`,
    );
  }
  return passed(
    "person",
    "eligible",
    comBiografia
      ? `Pessoa com foto, biografia exibivel e ${input.indexableWorkCount} obra(s) no indice.`
      : `Pessoa com foto e filmografia de ${input.indexableWorkCount} obras no indice (minimo ${piso} sem biografia).`,
  );
}
