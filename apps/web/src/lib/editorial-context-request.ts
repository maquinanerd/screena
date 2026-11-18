/**
 * editorial-context-request.ts — NUCLEO PURO do pedido ao Cinerie Context
 * Service (`POST /api/internal/editorial-context`). Nada de rede, banco ou
 * `process.env` aqui dentro.
 *
 * O QUE O PEDIDO DIZ. "Para estas obras, me de a ficha que a Cinerie pode
 * entregar." Cada item aponta UMA obra por um de tres caminhos, em ordem de
 * preferencia:
 *
 *  1. `entityId` — o id INTERNO do catalogo. Quem ja tem o id (o portal da
 *     Maquina Nerd, que o guardou na materia) nao paga resolucao de novo;
 *  2. `tmdbId` — identificador, exato;
 *  3. `slug` — o slug pt-BR da ficha (o que vem no endereco
 *     `https://cinerie.com/pt/filmes/<slug>/`). Exato: e a mesma busca da
 *     pagina publica, que aceita o slug canonico e os antigos;
 *  4. `title` (+ `year`, recomendado) — passa pelo MESMO tradutor da rota
 *     `/api/internal/entity-resolve`, com as mesmas recusas: titulo repetido no
 *     catalogo volta `null` com motivo, nunca "o mais popular".
 *
 * So `movie` e `tv`. Pessoa, temporada e episodio tem outro contrato de
 * identidade (ver `entity-resolve.ts`) e nao tem ficha de titulo.
 *
 * POR QUE NAO REAPROVEITAR O PARSER DO RESOLVE. O resolve aceita 50 itens de
 * nome curto e devolve ids; aqui cada item custa uma ficha inteira (sinopse,
 * elenco, trailer, ofertas, imagens). O teto e outro, e o `entityId` e um
 * caminho que o resolve nao tem.
 */

import { foldEntityText } from "./entity-resolve";

/** Tipos que tem ficha de titulo. */
export const CONTEXT_KINDS = ["movie", "tv"] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

/**
 * Obras por chamada.
 *
 * Uma materia fala de UMA obra quase sempre, e de tres em lista ou
 * comparacao. Cinco cobre o caso real com folga; cada item sao ~10 leituras
 * indexadas, e um teto alto faria uma unica chamada virar varredura.
 */
export const MAX_CONTEXT_ITEMS = 5;

/** Corpo maximo. Cinco itens com titulo longo cabem em 2 KiB; 16 KiB e folga. */
export const MAX_CONTEXT_REQUEST_BYTES = 16 * 1024;

const MAX_TEXT_LENGTH = 300;
const MIN_YEAR = 1870;
const MAX_YEAR = 2200;

/** Mesmo formato do `stableId` do contrato: o eco nao pode quebrar a resposta. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** Id interno: inteiro positivo serializado (BIGINT no banco). */
const ENTITY_ID_PATTERN = /^[1-9][0-9]{0,18}$/;

/** Slug de ficha: kebab-case minusculo, como o catalogo grava. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 200;

/** Um item do pedido, ja normalizado. Exatamente UM caminho vale por item. */
export type ContextItem =
  | { readonly index: number; readonly kind: ContextKind; readonly by: "entity_id"; readonly entityId: string }
  | { readonly index: number; readonly kind: ContextKind; readonly by: "tmdb_id"; readonly tmdbId: number }
  | { readonly index: number; readonly kind: ContextKind; readonly by: "slug"; readonly slug: string }
  | {
      readonly index: number;
      readonly kind: ContextKind;
      readonly by: "title";
      /** Titulo DOBRADO (mesma dobra do resolve). */
      readonly folded: string;
      readonly year: number | null;
    };

export interface ContextRequest {
  readonly requestId: string | null;
  readonly items: readonly ContextItem[];
}

export interface ContextRequestRejection {
  readonly code: "invalid_json" | "validation_failed" | "too_many_items" | "payload_too_large";
  readonly status: number;
  readonly issues: readonly string[];
}

export type ContextRequestParse =
  | { readonly ok: true; readonly request: ContextRequest }
  | { readonly ok: false; readonly rejection: ContextRequestRejection };

function reject(
  code: ContextRequestRejection["code"],
  status: number,
  issues: readonly string[],
): ContextRequestParse {
  return { ok: false, rejection: { code, status, issues } };
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Le e valida o corpo.
 *
 * Um item invalido derruba o PEDIDO inteiro (`422` com a lista de problemas),
 * e nao so o item: quem chama e um robo, e um erro de montagem no robo tem de
 * aparecer na primeira chamada — nao como uma ficha que "as vezes some".
 */
export function parseEditorialContextRequest(body: unknown, rawBodyBytes: number): ContextRequestParse {
  if (rawBodyBytes > MAX_CONTEXT_REQUEST_BYTES) {
    return reject("payload_too_large", 413, [
      `corpo com ${String(rawBodyBytes)} bytes; teto ${String(MAX_CONTEXT_REQUEST_BYTES)}`,
    ]);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return reject("invalid_json", 400, ["corpo precisa ser um objeto JSON"]);
  }

  const record = body as Record<string, unknown>;
  const issues: string[] = [];

  let requestId: string | null = null;
  if (record.requestId !== undefined) {
    const value = text(record.requestId);
    if (value === null || !REQUEST_ID_PATTERN.test(value)) {
      issues.push("requestId fora do formato (letras, numeros, . _ : -; ate 200)");
    } else {
      requestId = value;
    }
  }

  if (record.language !== undefined && record.language !== "pt-BR") {
    issues.push('language: so "pt-BR" e servido hoje');
  }

  const rawItems = record.items;
  if (!Array.isArray(rawItems)) {
    return reject("validation_failed", 422, ["items precisa ser uma lista", ...issues]);
  }
  if (rawItems.length === 0) {
    return reject("validation_failed", 422, ["items esta vazio", ...issues]);
  }
  if (rawItems.length > MAX_CONTEXT_ITEMS) {
    return reject("too_many_items", 422, [
      `${String(rawItems.length)} itens; teto ${String(MAX_CONTEXT_ITEMS)} por chamada`,
    ]);
  }

  const items: ContextItem[] = [];
  rawItems.forEach((raw, index) => {
    const item = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (item === null) {
      issues.push(`items[${String(index)}] precisa ser um objeto`);
      return;
    }
    const kindText = text(item.kind);
    if (kindText === null || !(CONTEXT_KINDS as readonly string[]).includes(kindText)) {
      issues.push(`items[${String(index)}].kind precisa ser "movie" ou "tv"`);
      return;
    }
    const kind = kindText as ContextKind;

    if (item.entityId !== undefined) {
      const entityId = typeof item.entityId === "number" ? String(item.entityId) : text(item.entityId);
      if (entityId === null || !ENTITY_ID_PATTERN.test(entityId)) {
        issues.push(`items[${String(index)}].entityId precisa ser um id interno numerico`);
        return;
      }
      items.push({ index, kind, by: "entity_id", entityId });
      return;
    }

    if (item.tmdbId !== undefined) {
      const tmdbId = positiveInteger(item.tmdbId);
      if (tmdbId === null) {
        issues.push(`items[${String(index)}].tmdbId precisa ser inteiro positivo`);
        return;
      }
      items.push({ index, kind, by: "tmdb_id", tmdbId });
      return;
    }

    if (item.slug !== undefined) {
      const slug = text(item.slug);
      if (slug === null || slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
        issues.push(`items[${String(index)}].slug precisa ser kebab-case minusculo`);
        return;
      }
      items.push({ index, kind, by: "slug", slug });
      return;
    }

    const title = text(item.title);
    if (title === null) {
      issues.push(`items[${String(index)}] precisa de entityId, tmdbId, slug ou title`);
      return;
    }
    if (title.length > MAX_TEXT_LENGTH) {
      issues.push(`items[${String(index)}].title acima de ${String(MAX_TEXT_LENGTH)} caracteres`);
      return;
    }
    let year: number | null = null;
    if (item.year !== undefined && item.year !== null) {
      const value = positiveInteger(item.year);
      if (value === null || value < MIN_YEAR || value > MAX_YEAR) {
        issues.push(`items[${String(index)}].year fora de ${String(MIN_YEAR)}-${String(MAX_YEAR)}`);
        return;
      }
      year = value;
    }
    const folded = foldEntityText(title);
    if (folded === "") {
      issues.push(`items[${String(index)}].title vazio depois de normalizado`);
      return;
    }
    items.push({ index, kind, by: "title", folded, year });
  });

  if (issues.length > 0) return reject("validation_failed", 422, issues);
  return { ok: true, request: { requestId, items } };
}
