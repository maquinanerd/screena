/**
 * help.ts — Texto de ajuda da CLI `pnpm ratings`. PURO (so string).
 */

import { DEFAULT_LIMIT, MAX_BULK_IDS, MAX_LIMIT } from './args.js'

/** Ajuda completa da CLI. */
export function renderRatingsHelp(): string {
  return `pnpm ratings — worker offline de ratings externos (NUNCA no render)

USO
  pnpm ratings <comando> [flags]

COMANDOS
  sample    Inspeciona o payload do fornecedor e RELATA o que seria reconhecido.
            Nunca escreve. Exige chave de API (faz chamada real).
  sync      Persiste em external_ratings. Toda linha nasce display_allowed=false
            e license_status=unknown. Dry-run por default; use --apply.
  review    Lista notas candidatas a promocao e por que cada uma pode/nao pode
            subir. Read-only, so banco (sem rede, sem chave).
  promote   Liga display_allowed nas notas dadas. Dry-run por default; exige
            --confirm E --reviewer. So banco.
  revoke    Desliga display_allowed nas notas dadas. Dry-run por default.

FLAGS
  --source=<fonte>    imdb|rotten_tomatoes|metacritic|letterboxd|filmaffinity
  --entity=<tipo>     movie|tv (default: movie)
  --limit=<n>         default ${DEFAULT_LIMIT}, teto ${MAX_LIMIT}
  --id=tt0000000      IMDb id de um titulo especifico
  --ids=1,2,3         ids de external_ratings (teto ${MAX_BULK_IDS} por lote)
  --reviewer=<quem>   identidade HUMANA do revisor (obrigatorio com --confirm)
  --dry-run           default em todo comando de escrita (explicito e redundante)
  --apply             sync: persiste de verdade
  --confirm           promote/revoke: executa de verdade
  --json              saida JSON sanitizada (sem segredo, sem payload cru)
  --help

EXEMPLOS
  pnpm ratings sample --source imdb --entity movie --limit 20 --dry-run
  pnpm ratings sync --entity movie --limit 20 --apply
  pnpm ratings review --source imdb --limit 50
  pnpm ratings promote --ids=101,102 --reviewer=ana@cinerie --confirm
  pnpm ratings revoke --ids=101 --confirm

GOVERNANCA
  - Escrita e SEMPRE dry-run por default. --apply/--confirm nunca sao implicitos.
  - Promover uma nota NAO e um ato tecnico: e uma decisao editorial de licenca.
    Exige revisor humano nomeado e DataUsageDecision vigente para rating_display
    daquela fonte. O trigger do banco recusa qualquer atalho.
  - Esta CLI nunca inventa licenca, nota, votos ou atribuicao.
  - Zero rede em review/promote/revoke: so PostgreSQL.
`
}
