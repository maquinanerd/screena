/**
 * editorial-media.ts — Leitura SERVER-ONLY da midia editorial publicada.
 *
 * Fecha a ponta que faltava do caminho dos bytes descrito em
 * `docs/operations/editorial-media-projection.md`:
 *
 *   worker grava no storage (chave derivada do conteudo)
 *     -> screen-db guarda `public_path` + `storage_key`
 *     -> [ESTE MODULO] resolve `public_path` -> bytes
 *     -> apps/web serve /media/editorial/...
 *
 * Ate aqui a ultima seta nao existia: o worker recusa o driver `local` em
 * producao (`storage-config.ts:82-91`), entao os bytes so podem estar no
 * bucket, enquanto o banco grava um caminho de SITE que apenas o `public/` do
 * screen-app serviria. Nenhum dos dois estava errado — faltava o leitor.
 *
 * POR QUE UM LEITOR PROPRIO, E NAO O ADAPTER DO WORKER.
 *
 *  1. O site e LEITOR. O `MediaStoragePort` do worker carrega `put` e `delete`;
 *     importa-lo daria ao processo publico a capacidade de APAGAR midia. Aqui so
 *     `GetObject` entra, e a credencial configurada no screen-app pode (e deve)
 *     ser um token somente-leitura.
 *  2. `@screena/news-ingestion` publica `exports: { ".": "./src/index.ts" }` —
 *     o deep import do adapter esta fechado, e abri-lo criaria uma aresta
 *     apps/web -> worker que `tests/governance/editorial-worker-boundary.test.ts`
 *     existe para evitar.
 *  3. Nao ha duplicacao do contrato de chave porque nao ha DERIVACAO aqui: a
 *     chave usada contra o bucket sai da coluna `storage_key` da linha casada
 *     por `public_path`. A URL nunca vira chave. A nao-duplicacao vem de
 *     eliminar a necessidade, nao de compartilhar codigo.
 *
 * INVARIANTES. Isto NAO viola "zero API externa no render" (invariante 3): esta
 * rota nao e pagina indexavel — devolve bytes de imagem, sem HTML, sem schema,
 * sem canonical, e o middleware ja a exclui do matcher. O render de HTML
 * continua lendo so PostgreSQL/cache local; uma falha do bucket degrada a
 * imagem, nunca a pagina. E estritamente mais conservador que o precedente ja
 * aceito do poster de catalogo, cujo CDN remoto o navegador busca direto, fora
 * da nossa origem (ver `scripts/audit/check-render-purity.mjs:12-18`).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { getPrismaClient } from "@screena/db/server";

import {
  resolveEditorialMediaReadConfig,
  type EditorialMediaLocalRead,
  type EditorialMediaS3Read,
} from "../lib/editorial-media-config";
import { isSafeStoredObjectKey } from "../lib/editorial-media-path";

/* ------------------------------------------------------------------ */
/* Consulta ao banco                                                   */
/* ------------------------------------------------------------------ */

export interface ServeableEditorialMedia {
  readonly storageKey: string;
  readonly mimeType: string;
}

/**
 * Estados de licenca cuja midia pode ser servida.
 *
 * ALLOWLIST, nao denylist: um status novo no enum nasce PROIBIDO. E a mesma
 * escolha do endpoint interno do CMS (ver `editorial-media-projection.md` §2),
 * pelo mesmo motivo — `restricted` existe para uso condicionado, e a condicao
 * nao esta modelada.
 */
const SERVEABLE_LICENSE_STATUSES: ReadonlySet<string> = new Set(["approved"]);

/**
 * Casa o caminho publico com um asset SERVIVEL.
 *
 * A licenca e reconferida no momento de servir, nao so na projecao: uma licenca
 * que expirou depois da publicacao precisa parar de entregar bytes sem depender
 * de alguem lembrar de reprojetar (invariante 6).
 */
export async function findServeableEditorialMedia(
  lookupPath: string,
  now: Date = new Date(),
): Promise<ServeableEditorialMedia | null> {
  const prisma = getPrismaClient();
  const row = await prisma.editorialMediaAsset.findUnique({
    where: { publicPath: lookupPath },
    select: {
      storageKey: true,
      mimeType: true,
      licenseStatus: true,
      licenseExpiresAt: true,
      allowedForEditorial: true,
    },
  });

  if (row === null) return null;
  if (!SERVEABLE_LICENSE_STATUSES.has(String(row.licenseStatus))) return null;
  if (row.allowedForEditorial !== true) return null;
  if (row.licenseExpiresAt !== null && row.licenseExpiresAt.getTime() <= now.getTime()) return null;
  if (!isSafeStoredObjectKey(row.storageKey)) return null;
  if (row.mimeType === "") return null;

  return { storageKey: row.storageKey, mimeType: row.mimeType };
}

/* ------------------------------------------------------------------ */
/* Leitura dos bytes                                                   */
/* ------------------------------------------------------------------ */

export type EditorialMediaReadResult =
  | { readonly status: "found"; readonly bytes: Uint8Array }
  | { readonly status: "missing" }
  | { readonly status: "unavailable"; readonly reason: string };

/** Cliente S3 do processo. Criado uma vez: um por request esgotaria sockets. */
let cachedS3Client: { send(command: unknown): Promise<unknown> } | null = null;

async function readFromS3(
  config: EditorialMediaS3Read,
  key: string,
): Promise<EditorialMediaReadResult> {
  // Import dinamico: mantem o SDK fora do grafo de modulos das paginas, que
  // nunca tocam midia. So a rota de bytes paga por ele.
  const { GetObjectCommand, S3Client } = await import("@aws-sdk/client-s3");

  cachedS3Client ??= new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  try {
    const result = (await cachedS3Client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    )) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } | null };
    const toBytes = result.Body?.transformToByteArray;
    if (toBytes === undefined) return { status: "missing" };
    return { status: "found", bytes: await toBytes.call(result.Body) };
  } catch (error) {
    if (isNotFound(error)) return { status: "missing" };
    // Nome do erro apenas. `$metadata`, bucket, endpoint e a requisicao assinada
    // vem juntos no erro do SDK e nao podem chegar ao log nem a resposta.
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.name : "desconhecido",
    };
  }
}

/** 404/NoSuchKey nas varias formas em que o SDK e os compativeis reportam. */
function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  if (candidate.name === "NoSuchKey" || candidate.name === "NotFound") return true;
  return candidate.$metadata?.httpStatusCode === 404;
}

async function readFromLocal(
  config: EditorialMediaLocalRead,
  key: string,
): Promise<EditorialMediaReadResult> {
  // `key` ja passou por isSafeStoredObjectKey; o resolve+prefixo abaixo e a
  // segunda barreira, para que nem uma linha corrompida escape da raiz.
  const root = path.resolve(config.root);
  const target = path.resolve(root, key);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return { status: "missing" };
  }
  try {
    return { status: "found", bytes: await readFile(target) };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
      return { status: "missing" };
    }
    return { status: "unavailable", reason: typeof code === "string" ? code : "desconhecido" };
  }
}

/** Le os bytes do objeto ja autorizado. Nunca recebe caminho vindo da URL. */
export async function readEditorialMediaBytes(
  storageKey: string,
  env: Record<string, string | undefined> = process.env,
): Promise<EditorialMediaReadResult> {
  const resolved = resolveEditorialMediaReadConfig(env);
  if (!resolved.ok) return { status: "unavailable", reason: resolved.reason };
  return resolved.config.driver === "s3"
    ? readFromS3(resolved.config, storageKey)
    : readFromLocal(resolved.config, storageKey);
}
