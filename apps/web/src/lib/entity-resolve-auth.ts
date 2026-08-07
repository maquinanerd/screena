/**
 * entity-resolve-auth.ts — Credencial e teto de chamadas da rota interna de
 * resolucao. PURO: nada de rede, banco ou `process.env` lido daqui dentro (o
 * ambiente chega por parametro, para o modulo ser testavel sem servidor).
 *
 * POR QUE UM ESCOPO PROPRIO, E NAO O DO CMS. Os escopos existentes
 * (`draft_ingest`, `editorial_media_ingest`, `editorial_auto_publish`,
 * `publication_projection`) vivem em `service-accounts` — uma collection do
 * banco do **CMS**. Esta rota esta no `screen-app`, que nao alcanca aquele banco
 * (ADR 0015), e ler o catalogo publico e um poder diferente de escrever materia.
 * Reaproveitar uma daquelas chaves faria uma unica credencial vazada abrir os
 * dois lados da fronteira.
 *
 * O escopo aqui e `catalog_resolve`, e ele e declarado pelo NOME DA VARIAVEL:
 * `CINERIE_CATALOG_RESOLVE_API_KEYS`. Sem tabela de contas no `screen-app`, uma
 * lista de escopos por chave seria cerimonia sobre um conjunto de um elemento.
 *
 * NASCE DESLIGADA. Sem chave configurada a rota nao responde — e isso e o gate,
 * nao um `*_ENABLED` separado. Uma flag a mais so criaria o estado "ligada e sem
 * credencial", que nao serve para nada e da mais um jeito de errar o deploy.
 */

import { timingSafeEqual } from "node:crypto";

/** Chave reconhecida. `id` e o rotulo do log; a chave em si nunca e logada. */
export interface ResolveCredential {
  /** Identificador curto e ESTAVEL: prefixo da chave. Nunca a chave inteira. */
  readonly id: string;
}

/** Comprimento minimo de uma chave. Abaixo disso e placeholder, nao segredo. */
const MIN_KEY_LENGTH = 24;

/**
 * Le as chaves do ambiente.
 *
 * Formato: `CINERIE_CATALOG_RESOLVE_API_KEYS` com uma ou mais chaves separadas
 * por virgula. Mais de uma existe para ROTACAO: publica-se a nova, o emissor
 * troca, remove-se a velha — sem janela em que ninguem consegue chamar.
 *
 * Chave curta demais e IGNORADA em silencio na lista, mas contada em
 * `rejected`: o operador precisa saber que colocou algo que nao vale, e a
 * mensagem nunca pode carregar o valor.
 */
export function readResolveCredentials(env: Record<string, string | undefined>): {
  readonly credentials: readonly ResolveCredential[];
  readonly rejected: number;
} {
  const raw = (env.CINERIE_CATALOG_RESOLVE_API_KEYS ?? "").trim();
  if (raw === "") return { credentials: [], rejected: 0 };

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  const credentials: ResolveCredential[] = [];
  let rejected = 0;
  const seen = new Set<string>();
  for (const key of parts) {
    if (key.length < MIN_KEY_LENGTH) {
      rejected += 1;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    credentials.push({ id: credentialIdFor(key) });
  }
  return { credentials, rejected };
}

/**
 * Rotulo de uma chave para log e para o balde de rate limit.
 *
 * Os primeiros 8 caracteres. E o suficiente para dizer QUAL credencial estourou
 * o teto sem escrever o segredo em disco — e escrever o segredo em disco e
 * exatamente o que um log de auditoria bem-intencionado costuma fazer.
 */
export function credentialIdFor(key: string): string {
  return key.slice(0, 8);
}

/**
 * A chave apresentada e uma das configuradas?
 *
 * COMPARACAO DE TEMPO CONSTANTE, e o loop percorre TODAS as chaves mesmo depois
 * de achar: sair cedo devolveria, pelo tempo de resposta, a posicao da chave
 * certa na lista. `timingSafeEqual` exige buffers do mesmo tamanho, entao a
 * diferenca de comprimento e tratada antes — e ela ja vaza, inevitavelmente, o
 * comprimento; o que nao pode vazar e o conteudo.
 */
export function matchResolveCredential(
  keys: readonly string[],
  presented: string | null,
): ResolveCredential | null {
  if (presented === null || presented === "") return null;
  const presentedBuffer = Buffer.from(presented, "utf8");

  let found: ResolveCredential | null = null;
  for (const key of keys) {
    const keyBuffer = Buffer.from(key, "utf8");
    if (keyBuffer.length !== presentedBuffer.length) continue;
    if (timingSafeEqual(keyBuffer, presentedBuffer) && found === null) {
      found = { id: credentialIdFor(key) };
    }
  }
  return found;
}

/**
 * Extrai a chave do cabecalho `Authorization`.
 *
 * DOIS ESQUEMAS ACEITOS, e por razoes diferentes: `Bearer` e o que qualquer
 * cliente HTTP monta sem pensar, e `API-Key` e o que o MNScr ja usa para falar
 * com o CMS. Recusar o segundo obrigaria o emissor a manter duas formas de
 * montar o mesmo cabecalho — e e assim que alguem manda a chave no lugar errado.
 */
export function extractPresentedKey(authorization: string | null): string | null {
  if (authorization === null) return null;
  const value = authorization.trim();
  const match = /^(?:Bearer|API-Key)\s+(.+)$/i.exec(value);
  if (match === null) return null;
  const key = (match[1] ?? "").trim();
  return key === "" ? null : key;
}
