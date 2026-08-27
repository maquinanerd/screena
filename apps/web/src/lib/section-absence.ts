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
  | "noticias"
  /** Biografia da pessoa (tela 09) — o parágrafo de 68ch do cabeçalho. */
  | "biografia"
  /** Tira de FOTOS da pessoa (tela 09) — a galeria licenciada de `profile`. */
  | "fotos"
  /** Trilho "Em breve" — escopo de ROTA (home/filmes/series), nao de entidade. */
  | "em-breve"
  /** "Para voce" — trilho personalizado do hub de streaming (escopo de ROTA). */
  | "para-voce"
  /** "Continuar assistindo" — trilho PESSOAL de /pt/explorar (escopo de ROTA). */
  | "continuar-assistindo"
  /** Faixa de newsletter do rodape — escopo de CHROME, nao de rota nem entidade. */
  | "newsletter"
  /**
   * Creditos de fonte no rodape — escopo de CHROME.
   *
   * O bloco em si NUNCA some (o credito textual e obrigatorio). O que pode
   * faltar e a MARCA GRAFICA de uma fonte que a exige.
   */
  | "creditos-de-dados";

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
  /**
   * A formula do Cinerie Score existe e esta registrada, mas NENHUMA
   * `DataUsageDecision` de `cinerie_score_display` a autoriza.
   *
   * Este e o estado de 20/08/2026, e a causa NAO e falta de decisao interna: e
   * que as quatro fontes da formula proibem obra derivada nos proprios termos
   * (OMDb — que entrega IMDb, Rotten Tomatoes e Metacritic — e TMDB). Destravar
   * exige autorizacao POR ESCRITO das fontes, nao uma decisao nossa.
   *
   * Ver docs/legal/cinerie-score-derivative-authorization.md.
   */
  | "no_approved_formula"
  /**
   * Ha NOTA, mas de uma fonte so — insuficiente para COMPOR.
   *
   * Distinto de `no_rating_at_all` de proposito, e a distincao e o assunto: com
   * uma fonte so nao existe composicao, e exibir seria lavar o numero de um
   * terceiro e chamar de nosso. O piso e 2 (`MINIMUM_COUNTED_SOURCES`).
   *
   * `actionable: false` — e um fato sobre a cobertura DESTE titulo, nao um passo
   * pendente. Se virar acionavel um dia, sera por ingestao, nao por curadoria.
   */
  | "single_source_insufficient"
  /**
   * NAO ha nota nenhuma que possa compor o Cinerie Score neste titulo.
   *
   * Zero fontes contadas. Diferente de `single_source_insufficient`: la existe
   * numero e ele nao basta; aqui nao existe numero. Para o operador as duas
   * pedem acoes diferentes (a primeira, mais cobertura de fontes; a segunda,
   * qualquer cobertura), e sem a distincao as duas seriam o mesmo silencio.
   */
  | "no_rating_at_all"
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
  /**
   * NAO existe dataset de recomendacao deterministico para esta VERTICAL.
   *
   * E o caso da serie hoje: o unico parentesco declarado no schema e
   * `movie_collection_memberships` -> `collections`, que so existe para filme.
   * `tv_shows` liga a `networks` e `production_companies`, que agrupam milhares
   * de titulos sem parentesco — nao servem. Passo pendente, nao fato sobre a
   * obra: por isso `actionable: true`.
   */
  | "no_recommendation_dataset"
  /**
   * O dataset EXISTE para a vertical, mas este titulo nao esta nele — o filme
   * nao pertence a colecao nenhuma. E fato sobre a obra, nao passo pendente
   * (por isso `actionable: false`), pela mesma razao que separa
   * `no_offer_for_entity` de `no_authorized_provider`.
   */
  | "no_recommendation_for_entity"
  /** O catalogo nao tem elenco para este titulo. */
  | "no_cast"
  /** Nenhum artigo publicado vinculado a esta entidade. */
  | "no_linked_article"
  /**
   * NAO HA BIOGRAFIA EXIBIVEL — e a causa e mais funda que "ninguem escreveu".
   *
   * A pagina monta a biografia a partir de `meta_description` + `content_blocks`
   * de tipo `editorial_intro` publicaveis. Nenhuma das duas existe hoje para
   * quase ninguem, e a terceira origem possivel — a `biography` que o TMDB
   * devolve no detalhe de pessoa — E BAIXADA E DESCARTADA: `people` tem a
   * coluna de GOVERNANCA (`biography_source_status`) e NAO tem a coluna de
   * texto, entao `normalizePerson` nem tenta persistir (ver o cabecalho de
   * `services/ingestion/src/normalizers/person.ts`).
   *
   * `actionable: true`: ha um passo pendente que resolveria o catalogo inteiro
   * de uma vez, e ele exige tarefa aprovada para banco (coluna + migration).
   */
  | "no_biography_source"
  /**
   * NENHUMA foto de pessoa exibivel no catalogo inteiro.
   *
   * A tira da tela 09 le `tmdb_images` de `entity_type='person'` /
   * `image_type='profile'` que tenham sido PROMOVIDAS (`display_allowed` +
   * `license_status` em official/licensed) e ainda passem pela licenca da FONTE
   * (`source_licenses` para tmdb/image). Zero linhas em todo o catalogo
   * significa uma destas duas coisas, e as duas sao passo de operacao: a
   * promocao (`promote:media --target=person-photo`) nunca rodou, ou a licenca
   * de imagem deixou de autorizar e apagou a superficie inteira de uma vez.
   *
   * `actionable: true`: um comando/decisao pendente acende o catalogo todo.
   */
  | "no_licensed_person_photo"
  /**
   * HA foto exibivel em ALGUMA pessoa, mas nenhuma NESTA.
   *
   * Fato sobre a pessoa (o TMDB nao publicou retrato dela, ou o lote promovido
   * nao a alcancou), nao passo pendente — por isso `actionable: false`, pela
   * MESMA razao que separa `no_offer_for_entity` de `no_authorized_provider`.
   * Sem esta separacao, um catalogo inteiro de figurantes sem retrato afogaria
   * o unico evento que importa.
   */
  | "no_photo_for_person"
  /**
   * NENHUMA estreia futura no catalogo para a(s) vertical(is) desta rota.
   *
   * E sempre um passo pendente, nunca um fato: o mundo real tem estreias
   * futuras o ano inteiro. Um "Em breve" vazio significa que a ingestao de
   * upcoming nao cobriu aquela vertical (`ingest-public-catalog
   * --include-upcoming`) ou que as entidades chegaram sem slug canonico pt-BR.
   * Sem esta linha, `/pt/series/` sem serie futura e `/pt/series/` com a
   * ingestao nunca rodada sao visualmente identicos: nada.
   */
  | "no_upcoming_title"
  /**
   * HA estreias futuras, mas MENOS que o piso do trilho (HOME_UPCOMING_MIN).
   *
   * Motivo separado de proposito: "zero" e "tres, precisa de quatro" pedem
   * acoes diferentes e estao a distancias diferentes de acender. Colapsar os
   * dois num motivo so apagaria justamente o caso em que a ingestao ja
   * funciona e falta pouco. O campo `available` carrega quanto ja ha.
   */
  | "below_upcoming_floor"
  /**
   * NAO EXISTE servico de recomendacao personalizada exposto ao app publico.
   *
   * "Para voce" nao e um trilho vazio a espera de dado: nao ha, em lugar nenhum,
   * quem produza a recomendacao. Uma secao que NUNCA pode ter sucesso nao deve
   * renderizar — e a mesma regra da faixa de newsletter, pelo mesmo motivo: um
   * bloco que so sabe dizer "ainda nao" gasta a atencao do leitor a toa e ainda
   * faz a pagina parecer quebrada.
   *
   * `actionable: true`: e passo pendente (construir o servico), nunca um fato
   * sobre o catalogo.
   */
  | "no_recommendation_service"
  /**
   * NAO HA VISITANTE AUTENTICADO — e a secao so existe para uma pessoa.
   *
   * "Continuar assistindo" nao tem o que mostrar a quem nao entrou, e nao ha o
   * que consertar: e um fato sobre o REQUEST, nao sobre o deploy nem sobre o
   * catalogo. Por isso `actionable: false` — a maioria dos pageviews e anonima,
   * e marcar isso como acionavel afogaria o log.
   *
   * NAO confundir com "logado e sem historico": ali a secao PODE ter sucesso, e
   * o estado vazio honesto e a resposta certa.
   */
  | "no_authenticated_visitor"
  /**
   * NAO EXISTE onde guardar uma inscricao de newsletter.
   *
   * Nao ha modelo de inscricao em `packages/db/prisma`. Sem ele, o formulario so
   * poderia (a) mentir com `200 OK` ou (b) errar sempre — e um formulario que
   * nunca consegue ter sucesso gasta o gesto do leitor a toa: ele digita o
   * e-mail, aperta, e recebe erro. Entao a faixa nao renderiza, e este motivo diz
   * por que.
   *
   * `actionable: true`: e um passo pendente (tabela + flag), nunca um fato sobre
   * o site. O que exatamente destrava esta em `docs/frontend/newsletter.md`.
   */
  | "newsletter_storage_unavailable"
  /**
   * A licenca de uma fonte EXIGE (ou autoriza) a marca grafica, e o arquivo
   * oficial dela nao esta no repositorio.
   *
   * Nao e "esta fonte nao tem logo" — esse caso nao gera evento nenhum, porque
   * nada e devido. Este motivo significa uma OBRIGACAO DESCUMPRIDA: os termos da
   * API do TMDB pedem o logo ("You must use the TMDB logo to identify Your use
   * of TMDB, the TMDB APIs, or TMDB Content") e hoje so o credito textual vai ao
   * ar.
   *
   * A unica origem legitima do arquivo e a pagina de logos do proprio detentor;
   * desenhar uma aproximacao de marca registrada seria pior que a ausencia. Ate
   * o arquivo chegar, esta linha e a evidencia de que a pendencia existe — em
   * vez de um `logo_allowed=false` silencioso fingindo que nada e devido.
   *
   * `actionable: true`: o conserto e colocar um arquivo, e a licenca diz qual.
   */
  | "source_logo_asset_missing";

/** Uma linha de log estruturada. Sem segredo, sem payload cru, sem PII. */
export interface SectionAbsence {
  readonly event: "section_absent";
  readonly section: SectionKey;
  readonly reason: SectionAbsenceReason;
  /**
   * `person` entrou junto com o bloco de biografia (tela 09).
   *
   * Nao e alargamento de conveniencia: a biografia que falta e de UMA pessoa, e
   * `entityId` acha essa pessoa — exatamente o que este formato promete. As
   * alternativas seriam mentir (`entityType: "movie"` num log de pessoa) ou
   * usar o formato de ROTA, cujo campo `vertical` so conhece filme/serie. Log
   * que mente e pior que log que falta.
   */
  readonly entityType: "movie" | "tv" | "person";
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
  // Acionavel: o conserto e colocar UM arquivo no repositorio, e a linha de log
  // nomeia qual. Nao e um fato sobre o catalogo — e uma pendencia de operacao.
  "source_logo_asset_missing",
  "no_authorized_provider",
  "no_approved_formula",
  "no_awards_source",
  "no_recommendation_dataset",
  "no_biography_source",
  "no_licensed_person_photo",
  "no_upcoming_title",
  "below_upcoming_floor",
  "no_recommendation_service",
  "newsletter_storage_unavailable",
]);

export interface SectionAbsenceContext {
  readonly section: SectionKey;
  readonly reason: SectionAbsenceReason;
  readonly entityType: "movie" | "tv" | "person";
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
 * A MESMA ausencia, quando o bloco pertence a uma ROTA e nao a uma entidade.
 *
 * POR QUE UM SEGUNDO FORMATO, E NAO `entityId: "home"`. `SectionAbsence` promete
 * que `entityId` acha o titulo. O trilho "Em breve" da home nao e sobre titulo
 * nenhum: ele falta para a rota inteira. Enfiar `"home"` no campo de id seria
 * mentir no log — e log que mente e pior que log que falta. O que o operador
 * precisa aqui e a ROTA e a VERTICAL consultada.
 *
 * O consumidor continua sendo o mesmo `<SectionBoundary>`: os dois formatos
 * compartilham `event`/`section`/`reason`/`actionable`, que e tudo que ele le.
 */
export interface RouteSectionAbsence {
  readonly event: "section_absent";
  readonly section: SectionKey;
  readonly reason: SectionAbsenceReason;
  /** Path publico da rota (ex.: `/pt/series/`) — o que o operador abre. */
  readonly route: string;
  /** Qual dataset foi consultado e nao rendeu bloco. */
  readonly vertical: "movie" | "series" | "mixed";
  /**
   * Quantos itens EXISTIAM (0 quando nao ha nenhum). E a diferenca entre
   * "a ingestao nao rodou" e "faltou um titulo para o piso" — sem o numero, o
   * operador nao sabe se esta longe ou perto de acender. Omitido quando o bloco
   * nao e contavel.
   */
  readonly available?: number;
  readonly actionable: boolean;
}

export interface RouteSectionAbsenceContext {
  readonly section: SectionKey;
  readonly reason: SectionAbsenceReason;
  readonly route: string;
  readonly vertical: "movie" | "series" | "mixed";
  readonly available?: number;
}

/** Monta o evento de rota. Nao escreve nada — quem escreve e o chamador. */
export function buildRouteSectionAbsence(
  context: RouteSectionAbsenceContext,
): RouteSectionAbsence {
  return {
    event: "section_absent",
    section: context.section,
    reason: context.reason,
    route: context.route,
    vertical: context.vertical,
    // `undefined` some do JSON.stringify: bloco nao contavel nao ganha a chave.
    available: context.available,
    actionable: ACTIONABLE_REASONS.has(context.reason),
  };
}

/**
 * A MESMA ausencia, quando o bloco pertence ao CHROME e nao a uma rota.
 *
 * POR QUE UM TERCEIRO FORMATO. Pelo mesmo motivo que existe o segundo: os campos
 * dos outros dois seriam MENTIRA aqui. A faixa de newsletter do rodape nao e
 * sobre titulo nenhum (`entityId` nao acha nada) e nao e sobre rota nenhuma —
 * ela falta em TODAS, sempre pela mesma causa. Escrever `route: "/pt/"` diria ao
 * operador que o problema e daquela pagina, e ele iria olhar o lugar errado.
 *
 * O que o operador precisa aqui e a SUPERFICIE (onde o buraco esta) e a causa.
 * Mais nada — porque nao ha mais nada de verdadeiro a dizer.
 *
 * O consumidor continua sendo o mesmo `<SectionBoundary>`: os tres formatos
 * compartilham `event`/`section`/`reason`/`actionable`, que e tudo que ele le.
 */
export interface ChromeSectionAbsence {
  readonly event: "section_absent";
  readonly section: SectionKey;
  readonly reason: SectionAbsenceReason;
  /** Parte do chrome global onde o bloco deveria estar. */
  readonly surface: "header" | "footer";
  readonly actionable: boolean;
}

export interface ChromeSectionAbsenceContext {
  readonly section: SectionKey;
  readonly reason: SectionAbsenceReason;
  readonly surface: "header" | "footer";
}

/** Monta o evento de chrome. Nao escreve nada — quem escreve e o chamador. */
export function buildChromeSectionAbsence(
  context: ChromeSectionAbsenceContext,
): ChromeSectionAbsence {
  return {
    event: "section_absent",
    section: context.section,
    reason: context.reason,
    surface: context.surface,
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
export function formatSectionAbsence(
  absence: SectionAbsence | RouteSectionAbsence | ChromeSectionAbsence,
): string {
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
  | {
      readonly rendered: false;
      readonly value: null;
      readonly absence: SectionAbsence | RouteSectionAbsence | ChromeSectionAbsence;
    };

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

/**
 * `decideSection` para blocos de ROTA (home, indice de filmes, indice de
 * series). Mesmas regras — lista vazia e ausencia de proposito —, so muda o
 * escopo que vai para o log.
 */
export function decideRouteSection<T>(
  value: T | null | undefined,
  context: RouteSectionAbsenceContext,
): SectionDecision<T> {
  const empty =
    value === null || value === undefined || (Array.isArray(value) && value.length === 0);

  if (empty) {
    return { rendered: false, value: null, absence: buildRouteSectionAbsence(context) };
  }
  return { rendered: true, value: value as T, absence: null };
}
