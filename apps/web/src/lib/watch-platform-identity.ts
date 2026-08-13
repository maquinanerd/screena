/**
 * watch-platform-identity.ts — Quem e a PLATAFORMA de uma oferta. PURO.
 *
 * O PROBLEMA. Uma oferta de streaming chega por dois fornecedores tecnicos, e
 * eles nomeiam a mesma plataforma de formas diferentes:
 *
 *   RapidAPI (Movie of the Night)  provider_key = "netflix"
 *   TMDB (JustWatch)               provider_key = "8"   (o provider_id numerico)
 *
 * `provider_key` e a chave do FORNECEDOR, nunca da plataforma. Agrupar por ela
 * lista a Netflix DUAS vezes, como se fossem dois servicos. O nome tambem nao
 * serve de identidade: os dois lados escrevem o que querem ("Prime Video" de um
 * lado, "Amazon Prime Video" do outro).
 *
 * A identidade e o `watch_providers.slug` — a linha canonica que existe
 * exatamente para dizer que "netflix" e "8" sao a mesma coisa. O painel de
 * detalhe ja usava isso; o hub `/pt/onde-assistir` e o destaque de `discover`
 * nao, porque cada um reimplementava o agrupamento por conta propria.
 *
 * POR QUE ISTO E UM MODULO E NAO UM `if` EM CADA LUGAR. Sao QUATRO consumidores
 * de `licensedWatchWhere` (painel, faixa da home, discover, hub). Quando o
 * portao foi aberto as duas origens, dois foram atualizados e dois nao — e o
 * defeito so apareceria com as duas origens promovidas, ou seja, em producao.
 * Regra critica repetida em quatro lugares diverge; num lugar so, nao.
 */

/** O que se sabe de uma oferta antes de decidir a que plataforma ela pertence. */
export interface WatchPlatformSource {
  /** `watch_availability.provider_name` — o nome que o FORNECEDOR escreveu. */
  readonly providerName: string;
  /** `watch_availability.provider_key` — chave do fornecedor, nao da plataforma. */
  readonly providerKey: string | null;
  /** `watch_providers.slug` — a identidade canonica. Null sem alias mapeado. */
  readonly providerSlug: string | null;
  /** `watch_providers.canonical_name` — o nome da plataforma, nao o do fornecedor. */
  readonly canonicalName: string | null;
}

/** A plataforma resolvida: por que chave agrupar e que nome exibir. */
export interface WatchPlatformIdentity {
  /**
   * Chave de agrupamento. E o slug canonico quando ha alias; sem alias, cai
   * para um valor PREFIXADO com `vendor:`, que nunca colide com um slug real —
   * a linha passa a responder so por si mesma, que e o comportamento honesto:
   * sem alias nao temos como afirmar que ela e a mesma plataforma de outra.
   */
  readonly bucketKey: string;
  /**
   * Nome exibido. Prefere o canonico da plataforma. Com o balde unificado,
   * deixar o nome ao acaso da ordenacao faria a mesma plataforma mudar de nome
   * entre deploys, conforme qual origem tivesse o `fetched_at` mais novo.
   */
  readonly displayName: string;
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve a plataforma de uma oferta.
 *
 * Devolve `null` quando a oferta nao tem como ser atribuida a plataforma
 * nenhuma — sem nome exibivel ou sem chave de fornecedor. Uma oferta assim nao
 * pode virar entrada de lista: renderizar um servico sem nome e o "provedor
 * inventado" que o contrato proibe.
 */
export function resolveWatchPlatform(
  source: WatchPlatformSource,
): WatchPlatformIdentity | null {
  const vendorName = clean(source.providerName);
  const providerKey = clean(source.providerKey);
  if (vendorName === "" || providerKey === "") return null;

  const slug = clean(source.providerSlug);
  const canonical = clean(source.canonicalName);

  return {
    bucketKey: slug !== "" ? slug : `vendor:${providerKey}`,
    displayName: canonical !== "" ? canonical : vendorName,
  };
}

/**
 * Agrupa ofertas por plataforma, preservando a ordem de chegada.
 *
 * Existe para os consumidores que so precisam da LISTA de plataformas (o
 * destaque de `discover`), sem montar balde de titulos. Quem precisa do balde
 * usa `resolveWatchPlatform` diretamente e acumula o proprio conteudo — mas com
 * a MESMA chave, que e o ponto.
 */
export function distinctWatchPlatforms(
  sources: readonly WatchPlatformSource[],
): WatchPlatformIdentity[] {
  const byKey = new Map<string, WatchPlatformIdentity>();
  for (const source of sources) {
    const identity = resolveWatchPlatform(source);
    if (identity === null) continue;
    if (!byKey.has(identity.bucketKey)) byKey.set(identity.bucketKey, identity);
  }
  return [...byKey.values()];
}
