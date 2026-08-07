/**
 * outbox-claim-response.ts — "fila vazia" e "falhou" NAO sao a mesma resposta.
 *
 * O worker lia o `claim` assim:
 *
 *   return Array.isArray(result.events) ? result.events : []
 *
 * Toda resposta que nao trouxesse uma lista virava LISTA VAZIA. Uma resposta
 * 200 com corpo errado, um proxy devolvendo HTML, um campo renomeado numa
 * versao futura do CMS — tudo isso passava a significar exatamente a mesma
 * coisa que "nao ha nada a projetar". O worker dormia o intervalo, acordava,
 * lia lixo de novo, e o `/readyz` continuava verde porque o ciclo "terminou bem".
 *
 * Nao ha sintoma. O CMS parece saudavel, o worker parece saudavel, e a
 * projecao esta parada. Isso e o pior desfecho possivel numa ponte que so
 * existe para mover dado de um lado para o outro.
 *
 * Este modulo e PURO e devolve os dois casos separados. Fila vazia continua
 * sendo `events: []` — uma lista, com zero itens. Qualquer outra coisa e falha
 * classificada, e o laco do worker ja sabe o que fazer com falha: registra em
 * `recordCycleFailure`, espera o intervalo cheio e denuncia no `/readyz`.
 */

export type ClaimResponseParse =
  | { readonly ok: true; readonly events: readonly unknown[] }
  | { readonly ok: false; readonly code: string; readonly detail: string }

/**
 * Interpreta o corpo do `POST /internal/publication-outbox/claim`.
 *
 * O `claimed` do CMS e conferido contra o tamanho da lista de proposito: sao
 * dois campos que o mesmo servidor preenche, e divergirem significa que a
 * resposta foi montada por outra coisa (proxy, cache, versao incompativel).
 * Confiar na lista e ignorar a contagem seria descartar a unica verificacao
 * gratuita que a resposta oferece.
 */
export function parseClaimResponse(raw: unknown): ClaimResponseParse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'outbox_claim_malformed',
      detail: 'claim respondeu algo que nao e um objeto JSON',
    }
  }

  const body = raw as { events?: unknown; claimed?: unknown; error?: unknown }

  // Um corpo de ERRO com status 2xx e a forma mais enganosa de falhar: o
  // `response.ok` do fetch nao pega, e sem esta linha ele viraria fila vazia.
  if (typeof body.error === 'string' && body.error.trim() !== '') {
    return {
      ok: false,
      code: 'outbox_claim_error_body',
      detail: `claim respondeu com erro no corpo: ${body.error.trim().slice(0, 120)}`,
    }
  }

  if (!Array.isArray(body.events)) {
    return {
      ok: false,
      code: 'outbox_claim_malformed',
      detail: 'claim respondeu sem a lista `events`; fila vazia seria `events: []`',
    }
  }

  if (typeof body.claimed === 'number' && body.claimed !== body.events.length) {
    return {
      ok: false,
      code: 'outbox_claim_inconsistent',
      detail: `claim declarou ${String(body.claimed)} evento(s) e entregou ${String(body.events.length)}`,
    }
  }

  return { ok: true, events: body.events }
}
