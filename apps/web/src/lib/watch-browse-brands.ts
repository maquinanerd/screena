/**
 * watch-browse-brands.ts — Agrupamento por MARCA no hub /pt/onde-assistir. PURO.
 *
 * ============ O PROBLEMA, MEDIDO ============
 *
 * A leva BR registrou 24 provedores novos. Com eles o hub passou a listar, lado
 * a lado e como se fossem servicos diferentes, "Paramount Plus", "Paramount Plus
 * Premium" e "Paramount+ Amazon Channel" — tres abas, tres entradas na fileira
 * do hero. Tudo verdade factual; nada disso pode sumir. O que muda e a
 * APRESENTACAO: a marca aparece uma vez, com as rotas embaixo.
 *
 * O painel por TITULO ja fazia isso desde a decisao de 2026-08-19
 * (`watch-availability-presenter.ts`). O hub nao — e a mesma pagina passou a
 * contar duas historias sobre o mesmo provedor.
 *
 * ============ DECLARADO, NUNCA DERIVADO DO NOME ============
 *
 * A decomposicao vem de `@screena/public-contracts` (`findWatchBrand`), a MESMA
 * fonte do painel de titulo. Nao ha ramo que adivinhe marca cortando sufixo de
 * string: o nome vem verbatim de terceiro e muda sem aviso, nomes parecidos nao
 * sao a mesma marca ("Claro video" x "Claro tv+") e nomes diferentes podem ser
 * ("HBO Max" x "HBO Max Amazon Channel"). O cabecalho de `watch-brand.ts`
 * detalha os tres casos.
 *
 * Provedor sem `brand` declarada aparece SOZINHO, com o proprio nome, como
 * sempre apareceu. Agrupar e opt-in; nao existe `else`.
 *
 * Sem rede, sem DB, sem `Date`: recebe provedores, devolve marcas.
 */

import { findWatchBrand, watchRouteLabel } from "@screena/public-contracts";
import type { WatchBrandDeclaration } from "@screena/public-contracts";

/** Um provedor canonico do hub, com os titulos que ele carrega. */
export interface BrowseProviderInput<T> {
  /** `watch_providers.slug` — identidade canonica, nunca a chave do fornecedor. */
  readonly providerSlug: string;
  /** Nome como o upstream escreveu. Usado quando NAO ha marca declarada. */
  readonly providerName: string;
  readonly titles: readonly T[];
}

/** Uma rota (assinatura direta, plano, canal) dentro de uma marca. */
export interface BrowseBrandRoute {
  readonly providerSlug: string;
  /** Nome cru do provedor daquela rota — o que o upstream escreveu. */
  readonly providerName: string;
  /**
   * Rotulo pt-BR da rota ("direto", "plano Premium", "canal no Prime Video").
   * `null` quando a rota nao precisa de rotulo: marca de uma rota so.
   */
  readonly label: string | null;
}

/** Uma marca do hub: um nome, N rotas, e a uniao dos titulos das rotas. */
export interface WatchBrowseBrand<T> {
  /** Chave estavel para React e para o estado da aba. */
  readonly key: string;
  /** O nome que o leitor reconhece. */
  readonly name: string;
  /** `true` quando veio de declaracao; `false` = provedor sozinho, nome cru. */
  readonly declared: boolean;
  readonly routes: readonly BrowseBrandRoute[];
  readonly titles: readonly T[];
}

/**
 * Ordem das rotas DENTRO da marca: primeiro a que da acesso mais direto.
 *
 * 0 = assinatura direta; 1 = plano/edicao da propria marca; 2 = canal vendido
 * dentro de um hospedeiro (exige o hospedeiro MAIS o canal, entao vem por
 * ultimo). Derivada da declaracao, nunca do nome.
 */
function routeRank(declaration: WatchBrandDeclaration | null): number {
  if (declaration === null || declaration.brand === null) return 0;
  if (declaration.soldVia !== null) return 2;
  if (declaration.variant !== null) return 1;
  return 0;
}

export function groupBrowseProvidersByBrand<T>(
  providers: readonly BrowseProviderInput<T>[],
  options: { readonly titleKey: (title: T) => string },
): WatchBrowseBrand<T>[] {
  interface Draft {
    key: string;
    name: string;
    declared: boolean;
    entries: Array<{
      provider: BrowseProviderInput<T>;
      declaration: WatchBrandDeclaration | null;
    }>;
  }

  const drafts = new Map<string, Draft>();

  for (const provider of providers) {
    const declaration = findWatchBrand(provider.providerSlug);
    const brand = declaration?.brand ?? null;
    // Prefixos disjuntos: uma marca chamada exatamente como o slug de outro
    // provedor nunca colide com ele.
    const key = brand === null ? `solo:${provider.providerSlug}` : `brand:${brand}`;

    const existing = drafts.get(key);
    if (existing === undefined) {
      drafts.set(key, {
        key,
        name: brand ?? provider.providerName,
        declared: brand !== null,
        entries: [{ provider, declaration }],
      });
    } else {
      existing.entries.push({ provider, declaration });
    }
  }

  const brands: WatchBrowseBrand<T>[] = [];
  for (const draft of drafts.values()) {
    const entries = [...draft.entries].sort((a, b) => {
      const byRank = routeRank(a.declaration) - routeRank(b.declaration);
      if (byRank !== 0) return byRank;
      // Empate entre canais: desempata pelo HOSPEDEIRO DECLARADO, nunca pelo
      // rotulo de terceiro (que muda no dia em que a TMDB renomear o provedor).
      const bySoldVia = (a.declaration?.soldVia ?? "").localeCompare(
        b.declaration?.soldVia ?? "",
      );
      if (bySoldVia !== 0) return bySoldVia;
      return a.provider.providerSlug.localeCompare(b.provider.providerSlug);
    });

    const aloneInBrand = entries.length === 1;

    // Uniao dos titulos das rotas, SEM repetir: o mesmo filme costuma estar na
    // rota direta e no canal, e o leitor nao precisa ver o poster duas vezes.
    const seen = new Set<string>();
    const titles: T[] = [];
    for (const entry of entries) {
      for (const title of entry.provider.titles) {
        const key = options.titleKey(title);
        if (seen.has(key)) continue;
        seen.add(key);
        titles.push(title);
      }
    }

    brands.push({
      key: draft.key,
      name: draft.name,
      declared: draft.declared,
      routes: entries.map((entry) => ({
        providerSlug: entry.provider.providerSlug,
        providerName: entry.provider.providerName,
        label: watchRouteLabel(entry.declaration, { aloneInBrand }),
      })),
      titles,
    });
  }

  brands.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "pt-BR");
    if (byName !== 0) return byName;
    return a.key.localeCompare(b.key); // desempate estavel
  });
  return brands;
}
