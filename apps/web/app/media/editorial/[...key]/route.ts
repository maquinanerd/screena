/**
 * /media/editorial/** — Bytes da midia editorial publicada.
 *
 * O worker de projecao grava o arquivo no storage publico e persiste em
 * `editorial_media_assets` o par (`public_path`, `storage_key`). O
 * `public_path` e um caminho de SITE (`/media/editorial/<xx>/<sha256>.<ext>`) —
 * nunca uma URL, e ha CHECK no banco garantindo isso. Esta rota e quem torna
 * esse caminho real: casa o caminho com a linha, reconfere a licenca e devolve
 * os bytes do objeto apontado pela COLUNA `storage_key`.
 *
 * A URL nunca vira chave de storage. Ela e so a busca; a chave sai do banco.
 *
 * PUREZA DE RENDER (invariante 3). Esta rota nao e pagina indexavel: devolve
 * `image/*`, sem HTML, sem JSON-LD, sem canonical, fora do sitemap, e o
 * middleware ja a exclui do matcher (`middleware.ts:87`). O caminho de render
 * de HTML segue lendo apenas PostgreSQL/cache local — uma indisponibilidade do
 * bucket degrada a IMAGEM, nunca a pagina.
 *
 * CACHE. Chave derivada do conteudo => objeto imutavel => `immutable` com um
 * ano. Respostas que NAO sao 200 saem `no-store` de proposito: um 404 cacheado
 * para um asset que o worker esta prestes a projetar reproduziria exatamente a
 * falha silenciosa que esta rota existe para eliminar.
 */

import type { NextRequest } from "next/server";

import { editorialMediaLookupPath } from "../../../../src/lib/editorial-media-path";
import {
  findServeableEditorialMedia,
  readEditorialMediaBytes,
} from "../../../../src/server/editorial-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/**
 * Corpo vazio em todo erro.
 *
 * Nao ha diferenca observavel entre "caminho malformado", "asset inexistente" e
 * "licenca nao permite": distinguir so ajudaria a enumerar o bucket.
 */
function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * 503, nao 404, quando o storage falha ou esta mal configurado.
 *
 * Confundir indisponibilidade com inexistencia faria um blip do bucket virar
 * "imagem nao existe" no monitoramento e em qualquer cache a frente.
 */
function unavailable(): Response {
  return new Response(null, {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ key?: string[] }> },
): Promise<Response> {
  const { key } = await context.params;

  const lookupPath = editorialMediaLookupPath(key);
  if (lookupPath === null) return notFound();

  let asset: Awaited<ReturnType<typeof findServeableEditorialMedia>>;
  try {
    asset = await findServeableEditorialMedia(lookupPath);
  } catch {
    // Banco fora e indisponibilidade, nao ausencia — mesmo raciocinio do 503
    // acima. Sem detalhe do erro: a mensagem do Prisma carrega a DATABASE_URL.
    return unavailable();
  }
  if (asset === null) return notFound();

  const result = await readEditorialMediaBytes(asset.storageKey);
  if (result.status === "unavailable") return unavailable();
  // Objeto ausente com linha presente e ORFAO invertido (linha sem arquivo).
  // 404 e a resposta honesta; o `no-store` deixa a correcao aparecer assim que
  // uma reprojecao regravar o arquivo.
  if (result.status === "missing") return notFound();

  // `Uint8Array<ArrayBufferLike>` deixou de casar com `BodyInit` quando o TS 5.7
  // tornou o tipo generico sobre o buffer. Em runtime o `Response` do Node
  // aceita Uint8Array sem ressalva; o descasamento e so da tipagem da lib, e
  // copiar o buffer so para satisfazer o compilador dobraria a memoria de pico
  // de cada imagem servida.
  const body = result.bytes as unknown as BodyInit;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": asset.mimeType,
      "cache-control": IMMUTABLE_CACHE,
      // Os bytes vieram de upload de terceiro. O MIME foi validado por
      // ASSINATURA na projecao, mas `nosniff` remove a chance de o navegador
      // reinterpretar o conteudo como algo executavel.
      "x-content-type-options": "nosniff",
    },
  });
}
