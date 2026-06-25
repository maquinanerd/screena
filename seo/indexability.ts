/**
 * seo/indexability.ts — Ponte (bridge) entre as rotas Next e o motor de
 * indexabilidade da Screena.
 *
 * ARQUITETURA:
 *   A LOGICA PURA de decisao (index | noindex | draft | stale | blocked) vive
 *   em `packages/seo` (@screena/seo). Ela e pura, testavel e sem IO: recebe um
 *   payload ja lido do PostgreSQL/cache local e devolve a decisao + motivos.
 *
 *   Este arquivo (`seo/indexability.ts`) e apenas a PONTE para as rotas do
 *   Next.js (App Router): reexporta e/ou embrulha `evaluateIndexability` para
 *   que `generateMetadata`/handlers consumam um ponto unico, sem importar o
 *   pacote interno diretamente em cada rota.
 *
 * INVARIANTES RELEMBRADAS:
 *   - Regra 3: nenhuma consulta a API externa acontece aqui nem no motor.
 *   - Regra 5: pagina fina (sem >=2 blocos de valor proprios) recebe noindex.
 *   - Regra 6: dado sem licenca clara (license_status unknown/blocked ou
 *     display_allowed=false) nao aparece em pagina indexavel.
 *   - Regra 7: en/es nascem em draft/noindex ate revisao humana.
 */

// A logica pura vive em packages/seo; este arquivo so faz a ponte para o Next.
import {
  evaluateIndexability,
  type IndexabilityInput,
  type IndexabilityResult,
} from '@screena/seo';

// Reexporta os tipos para que as rotas Next importem tudo de um lugar so.
export type { IndexabilityInput, IndexabilityResult };

/**
 * Wrapper fino sobre `evaluateIndexability` de @screena/seo.
 *
 * Mantemos a assinatura identica de proposito: a ponte nao adiciona regra de
 * negocio, apenas centraliza o ponto de import para as rotas Next e permite,
 * no futuro, anexar telemetria/logging (regra: todo sync externo gera log) sem
 * tocar no motor puro.
 *
 * @param input Payload de indexabilidade ja lido do banco local.
 * @returns Decisao de indexabilidade (index | noindex | draft | stale | blocked).
 */
export function resolveIndexability(
  input: IndexabilityInput,
): IndexabilityResult {
  return evaluateIndexability(input);
}

// Reexport direto do motor para consumidores que preferem o nome original.
export { evaluateIndexability };
