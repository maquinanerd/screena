/**
 * article-body-presenter.ts - Corpo ESTRUTURADO da materia: `article_translations
 * .body_blocks` -> view model de render. PURO: sem rede/DB/IO.
 *
 * Por que existe: a projecao editorial ja gravava os blocos no banco publico
 * (FASE 2C/2D) e a pagina do artigo renderizava apenas `body`, o texto achatado.
 * Tudo o que so existe na forma estruturada — imagem inline, video, citacao
 * destacada, ficha de entidade no meio do texto, box de fatos, lista de fontes —
 * chegava ao banco e morria ali.
 *
 * Regras duras desta camada:
 *  - NUNCA HTML livre. Todo bloco vira um no tipado que o React renderiza como
 *    TEXTO; nao existe `dangerouslySetInnerHTML` no caminho do corpo. O corpo de
 *    uma materia e conteudo, e conteudo nunca e codigo.
 *  - FAIL-CLOSED por bloco. Bloco de tipo desconhecido, malformado ou com
 *    referencia que nao resolve e DESCARTADO — nunca renderizado pela metade,
 *    nunca substituido por outro dado. Um bloco a menos e honesto; um bloco
 *    errado mente.
 *  - Imagem so LOCAL (`normalizeNewsLocalImagePath`): URL absoluta e recusada,
 *    igual ao hero. O worker grava caminho local por design.
 *  - Link externo so http(s) em host permitido. `javascript:`, `data:` e
 *    afins nao atravessam.
 *  - Fallback preservado: quando nao ha blocos, a pagina continua usando
 *    `bodyParagraphs(body)`. Esta camada nao substitui a antiga, soma a ela.
 */

import {
  buildNewsEntityCard,
  normalizeNewsLocalImagePath,
  type NewsEntityCard,
  type NewsEntityCardInput,
} from "./news-presenter";

/* ------------------------------------------------------------------ */
/* View model                                                          */
/* ------------------------------------------------------------------ */

export type ArticleBodyHeadingLevel = 2 | 3 | 4;

export interface ArticleBodyImage {
  src: string;
  alt: string;
  caption: string | null;
  credit: string | null;
  width: number | null;
  height: number | null;
}

export interface ArticleBodyFactItem {
  label: string;
  value: string;
}

export interface ArticleBodyLink {
  label: string;
  href: string;
}

export type ArticleBodyBlock =
  | { kind: "paragraph"; id: string; text: string }
  | { kind: "heading"; id: string; level: ArticleBodyHeadingLevel; text: string }
  | { kind: "image"; id: string; image: ArticleBodyImage }
  | {
      kind: "video";
      id: string;
      provider: "youtube" | "vimeo";
      href: string;
      title: string | null;
      credit: string | null;
    }
  | { kind: "quote"; id: string; text: string; attribution: string | null }
  | { kind: "entityCard"; id: string; card: NewsEntityCard; note: string | null }
  | { kind: "factBox"; id: string; title: string; items: ArticleBodyFactItem[] }
  | { kind: "relatedContent"; id: string; items: ArticleBodyLink[] }
  | { kind: "sourceList"; id: string; items: ArticleBodyLink[] }
  | { kind: "divider"; id: string };

/** Fatos do catalogo/CMS que os blocos referenciam, resolvidos no servidor. */
export interface ArticleBodyHydration {
  /** `${entityKind}:${entityId}` -> ficha do catalogo publico. */
  entityCards: ReadonlyMap<string, NewsEntityCardInput>;
  /** `payload_document_id` -> artigo publicavel (titulo + slug pt-BR). */
  relatedArticles: ReadonlyMap<string, { title: string; slug: string }>;
}

export const EMPTY_ARTICLE_BODY_HYDRATION: ArticleBodyHydration = {
  entityCards: new Map(),
  relatedArticles: new Map(),
};

/** Teto de blocos renderizados, espelhando `LIMITS.blocks` do contrato. */
export const MAX_ARTICLE_BODY_BLOCKS = 200;

const NEWS_PATH_PREFIX = "/pt/noticias/";

/**
 * Hosts de video permitidos quando o bloco traz `url` em vez de `externalId`.
 *
 * Allowlist e nao denylist: um bloco com host desconhecido nao vira link. O
 * corpo de uma materia e o lugar mais provavel de aparecer uma URL colada de
 * qualquer lugar, e transformar isso em link clicavel numa pagina indexavel e
 * emprestar reputacao a um destino que ninguem revisou.
 */
const VIDEO_HOSTS: ReadonlySet<string> = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "m.youtube.com",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
]);

/* ------------------------------------------------------------------ */
/* Leitura defensiva do JSON                                           */
/* ------------------------------------------------------------------ */

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * URL externa segura, ou `null`.
 *
 * `new URL` em vez de regex: o parser resolve as formas exoticas de escrever o
 * mesmo esquema (`JavaScript:`, `java\tscript:`) que uma regex de prefixo
 * deixaria passar.
 */
function externalHref(value: unknown, allowedHosts: ReadonlySet<string> | null): string | null {
  const raw = text(value);
  if (raw === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (allowedHosts !== null && !allowedHosts.has(parsed.host.toLowerCase())) return null;
  return parsed.toString();
}

/* ------------------------------------------------------------------ */
/* Blocos                                                             */
/* ------------------------------------------------------------------ */

function imageBlock(id: string, block: Record<string, unknown>): ArticleBodyBlock | null {
  // O worker grava `publicPath`; `src` existe como tolerancia a linhas antigas.
  const src = normalizeNewsLocalImagePath(
    text(block.publicPath) ?? text(block.src) ?? null,
  );
  if (src === null) return null;
  // `alt` vazio e ACEITO (imagem decorativa); ausente vira string vazia em vez
  // de bloquear o bloco. O que nao pode e `alt` inventado.
  const alt = typeof block.alt === "string" ? block.alt.trim() : "";
  return {
    kind: "image",
    id,
    image: {
      src,
      alt,
      caption: text(block.caption),
      credit: text(block.credit),
      width: positiveInt(block.width),
      height: positiveInt(block.height),
    },
  };
}

/**
 * Bloco de video -> LINK para o provedor, nunca `<iframe>`.
 *
 * Decisao consciente desta fatia: um embed e execucao de terceiro dentro de uma
 * pagina nossa (script do provedor, cookie, fingerprint) numa superficie
 * indexavel. O bloco continua sendo renderizado e clicavel; o que nao existe e
 * o script de terceiro no render. Trocar o link por embed e uma decisao de
 * produto/privacidade, com consentimento — nao um detalhe de apresentacao.
 */
function videoBlock(id: string, block: Record<string, unknown>): ArticleBodyBlock | null {
  const provider = text(block.provider);
  if (provider !== "youtube" && provider !== "vimeo") {
    // `internal` nao tem destino publico nesta fatia; provider desconhecido
    // nunca vira link.
    return null;
  }
  const externalId = text(block.externalId);
  let href: string | null = null;
  if (externalId !== null && provider === "youtube" && /^[A-Za-z0-9_-]{6,24}$/.test(externalId)) {
    href = `https://www.youtube.com/watch?v=${externalId}`;
  } else if (externalId !== null && provider === "vimeo" && /^[0-9]{5,15}$/.test(externalId)) {
    href = `https://vimeo.com/${externalId}`;
  } else {
    href = externalHref(block.url, VIDEO_HOSTS);
  }
  if (href === null) return null;
  return { kind: "video", id, provider, href, title: text(block.title), credit: text(block.credit) };
}

function factBoxBlock(id: string, block: Record<string, unknown>): ArticleBodyBlock | null {
  const title = text(block.title);
  if (title === null) return null;
  const raw = Array.isArray(block.items) ? block.items : [];
  const items: ArticleBodyFactItem[] = [];
  for (const entry of raw) {
    const item = record(entry);
    if (item === null) continue;
    const label = text(item.label);
    const value = text(item.value);
    // Par incompleto nao vira linha meia-boca: um fato sem valor nao e um fato.
    if (label === null || value === null) continue;
    items.push({ label, value });
  }
  if (items.length === 0) return null;
  return { kind: "factBox", id, title, items };
}

function relatedContentBlock(
  id: string,
  block: Record<string, unknown>,
  hydration: ArticleBodyHydration,
): ArticleBodyBlock | null {
  const refs = Array.isArray(block.articleRefs) ? block.articleRefs : [];
  const items: ArticleBodyLink[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = text(ref);
    if (key === null) continue;
    // Ref que nao resolve para artigo PUBLICAVEL nao vira link: seria 404
    // interno — ou, pior, link para materia agendada/retratada.
    const target = hydration.relatedArticles.get(key);
    if (target === undefined || seen.has(target.slug)) continue;
    seen.add(target.slug);
    items.push({ label: target.title, href: `${NEWS_PATH_PREFIX}${target.slug}/` });
  }
  if (items.length === 0) return null;
  return { kind: "relatedContent", id, items };
}

function sourceListBlock(id: string, block: Record<string, unknown>): ArticleBodyBlock | null {
  // O worker ja trocou `sourceRefs` (id interno do CMS) por `sources` resolvidas.
  const raw = Array.isArray(block.sources) ? block.sources : [];
  const items: ArticleBodyLink[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const source = record(entry);
    if (source === null) continue;
    const label = text(source.name);
    const href = externalHref(source.url, null);
    if (label === null || href === null || seen.has(href)) continue;
    seen.add(href);
    items.push({ label, href });
  }
  if (items.length === 0) return null;
  return { kind: "sourceList", id, items };
}

function entityCardBlock(
  id: string,
  block: Record<string, unknown>,
  hydration: ArticleBodyHydration,
): ArticleBodyBlock | null {
  const kind = text(block.entityKind);
  const entityId = text(block.entityId);
  if (kind === null || entityId === null) return null;
  const hydrated = hydration.entityCards.get(`${kind}:${entityId}`);
  if (hydrated === undefined) return null;
  // `buildNewsEntityCard` e o MESMO construtor da ficha do rodape: exige titulo
  // e slug reais e nunca inventa nota. Reusa-lo mantem uma unica definicao de
  // "ficha honesta" no produto.
  const card = buildNewsEntityCard(hydrated);
  if (card === null) return null;
  return { kind: "entityCard", id, card, note: text(block.note) };
}

function mapBlock(
  raw: unknown,
  index: number,
  hydration: ArticleBodyHydration,
): ArticleBodyBlock | null {
  const block = record(raw);
  if (block === null) return null;
  const type = text(block.type);
  if (type === null) return null;
  // Id do bloco e a ancora de comentario/correcao. Ausente, o indice serve de
  // chave de render — nunca motivo para descartar conteudo valido.
  const id = text(block.id) ?? `blk-${String(index)}`;

  switch (type) {
    case "paragraph": {
      const value = text(block.text);
      return value === null ? null : { kind: "paragraph", id, text: value };
    }
    case "heading": {
      const value = text(block.text);
      const level = block.level;
      if (value === null) return null;
      // `h1` pertence ao titulo da pagina; o corpo comeca em `h2`. Nivel fora do
      // contrato cai para `h2` em vez de derrubar o bloco — o texto do
      // subtitulo importa mais que o grau exato dele.
      const resolved: ArticleBodyHeadingLevel =
        level === 3 ? 3 : level === 4 ? 4 : 2;
      return { kind: "heading", id, level: resolved, text: value };
    }
    case "image":
      return imageBlock(id, block);
    case "video":
      return videoBlock(id, block);
    case "quote": {
      const value = text(block.text);
      return value === null
        ? null
        : { kind: "quote", id, text: value, attribution: text(block.attribution) };
    }
    case "entityCard":
      return entityCardBlock(id, block, hydration);
    case "factBox":
      return factBoxBlock(id, block);
    case "relatedContent":
      return relatedContentBlock(id, block, hydration);
    case "sourceList":
      return sourceListBlock(id, block);
    case "divider":
      return { kind: "divider", id };
    default:
      // Tipo desconhecido e DESCARTADO, nao renderizado como texto cru. Um bloco
      // futuro que ninguem sabe exibir nao pode virar JSON vazando na pagina.
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Entrada publica                                                     */
/* ------------------------------------------------------------------ */

/**
 * `body_blocks` (Json do PostgreSQL) -> blocos renderizaveis.
 *
 * Devolve `[]` quando a coluna e nula, nao e lista ou nenhum bloco sobrevive —
 * e ai a pagina cai no corpo textual legado. Nunca lanca: um bloco corrompido
 * numa materia nao pode derrubar a pagina inteira.
 */
export function buildArticleBodyBlocks(
  raw: unknown,
  hydration: ArticleBodyHydration = EMPTY_ARTICLE_BODY_HYDRATION,
): ArticleBodyBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ArticleBodyBlock[] = [];
  for (const [index, entry] of raw.entries()) {
    if (out.length >= MAX_ARTICLE_BODY_BLOCKS) break;
    const block = mapBlock(entry, index, hydration);
    if (block !== null) out.push(block);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Referencias a resolver no servidor                                  */
/* ------------------------------------------------------------------ */

export interface ArticleBodyReferences {
  /** Entidades citadas em blocos `entityCard`, por tipo. */
  entities: { entityKind: string; entityId: string }[];
  /** `payload_document_id` citados em blocos `relatedContent`. */
  articleRefs: string[];
}

/**
 * Varre os blocos crus e diz o que precisa ser buscado no banco.
 *
 * Existe para o servidor consultar UMA vez por tipo em vez de por bloco, e para
 * a decisao de "o que este corpo referencia" ficar aqui — pura e testavel — em
 * vez de espalhada na camada de dados.
 */
export function collectArticleBodyReferences(raw: unknown): ArticleBodyReferences {
  const entities: { entityKind: string; entityId: string }[] = [];
  const articleRefs: string[] = [];
  if (!Array.isArray(raw)) return { entities, articleRefs };

  const seenEntity = new Set<string>();
  const seenArticle = new Set<string>();
  for (const entry of raw) {
    const block = record(entry);
    if (block === null) continue;
    const type = text(block.type);
    if (type === "entityCard") {
      const entityKind = text(block.entityKind);
      const entityId = text(block.entityId);
      if (entityKind === null || entityId === null) continue;
      const key = `${entityKind}:${entityId}`;
      if (seenEntity.has(key)) continue;
      seenEntity.add(key);
      entities.push({ entityKind, entityId });
    } else if (type === "relatedContent") {
      for (const ref of Array.isArray(block.articleRefs) ? block.articleRefs : []) {
        const value = text(ref);
        if (value === null || seenArticle.has(value)) continue;
        seenArticle.add(value);
        articleRefs.push(value);
      }
    }
  }
  return { entities, articleRefs };
}
