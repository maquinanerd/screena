// @screena/types
// Unioes de string literais compartilhadas por todo o monorepo Screena.
// Pacote puro: SO tipos, sem runtime, sem side effects, sem dependencias.
// Estes literais sao o vocabulario canonico das entidades e dos fluxos
// editoriais/de indexacao; demais pacotes devem importar daqui em vez de
// redeclarar strings soltas.

/**
 * Tipo de entidade de catalogo.
 * Espelha a diferenciacao filme/serie que nunca depende so da cor.
 */
export type EntityType =
  | 'movie' // filme
  | 'tv' // serie
  | 'season' // temporada
  | 'episode' // episodio
  | 'person' // pessoa
  | 'franchise'; // franquia

/**
 * Idioma de conteudo.
 * pt-BR publica primeiro; en/es nascem em draft/noindex ate revisao humana.
 */
export type LanguageCode =
  | 'pt-BR' // portugues do Brasil (publica primeiro)
  | 'en' // ingles (draft/noindex no MVP)
  | 'es'; // espanhol (draft/noindex no MVP)

/**
 * Codigo de pais (ISO 3166-1 alpha-2 esperado, ex.: "BR", "US").
 * Mantido como string para nao travar a fundacao em um enum fechado.
 */
export type CountryCode = string;

/**
 * Status de revisao de content_blocks e conteudo gerado por IA.
 * Conteudo so vira "valor proprio" quando atinge um status permitido.
 */
export type ReviewStatus =
  | 'draft' // rascunho inicial
  | 'ai_generated' // gerado por IA, ainda nao revisado
  | 'needs_review' // aguardando revisao humana
  | 'human_reviewed' // revisado por humano
  | 'published' // publicado
  | 'needs_update' // marcado para atualizacao
  | 'blocked' // bloqueado (nao pode aparecer)
  | 'archived'; // arquivado

/**
 * Decisao de indexabilidade de uma pagina.
 * Pagina fina (sem >=2 blocos de valor proprios) recebe noindex.
 */
export type IndexStatus =
  | 'index' // pode ser indexada
  | 'noindex' // nao indexa (thin/sem valor proprio suficiente)
  | 'draft' // ainda em construcao
  | 'stale' // desatualizada, precisa de refresh
  | 'blocked'; // bloqueada (ex.: licenca/legal)

/**
 * Tipo de oferta de "onde assistir".
 * Sem pirataria: nada de torrent, IPTV, player ilegal ou embed pirata.
 */
export type OfferType =
  | 'subscription' // assinatura (catalogo)
  | 'rent' // aluguel
  | 'buy' // compra
  | 'free' // gratis (legal)
  | 'ads' // gratis com anuncios
  | 'cinema'; // exibicao em cinema

/**
 * Status de licenca de uma fonte de dados (ex.: ratings externos).
 * Dados unknown/blocked (ou display_allowed=false) nao entram em pagina indexavel.
 */
export type LicenseStatus =
  | 'official' // fonte oficial
  | 'licensed' // licenciada
  | 'third_party' // terceiros (uso condicionado)
  | 'unknown' // sem licenca clara
  | 'blocked'; // bloqueada para exibicao

/**
 * Status de um job do pipeline offline (ex.: entity_writer_jobs).
 * Toda escrita parte de payload controlado do PostgreSQL, nunca do render.
 */
export type JobStatus =
  | 'queued' // na fila
  | 'claimed' // reservado por um worker
  | 'running' // em execucao
  | 'completed' // concluido com sucesso
  | 'failed' // falhou
  | 'blocked' // bloqueado (dependencia/licenca)
  | 'cancelled'; // cancelado
