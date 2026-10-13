# Decisões do dono — 13/10/2026 (recusa do AdSense: curadoria da home)

> **O que este documento é.** Em 13/10/2026 o AdSense recusou `cinerie.com` por
> **"Conteúdo de baixo valor"** e pediu, antes de uma nova revisão, um site que
> "ofereça informações autênticas e de alta qualidade", "exiba curadoria e
> manutenção estrutural contínuas" e "gere interesse genuíno do usuário".
>
> A sessão mediu o site no ar e levou ao dono duas perguntas, porque o
> `CLAUDE.md` §6 reserva a ele a **indexação em massa** e porque a decisão de
> 24/09 dizia que **não mexia na home**. As respostas, dadas em chat pelo dono em
> 13/10/2026, estão abaixo. Este arquivo é o registro delas; o código cita o
> arquivo.
>
> Formato e precedente: [`DECISOES-DO-DONO-2026-09-24.md`](DECISOES-DO-DONO-2026-09-24.md).

---

## H1 · A home só destaca título que está no índice

**Decisão.** Toda vitrine de título da home (`/pt/`) passa a usar o **mesmo
portão de relevância do sitemap** (R1 de 24/09): fica o filme ou a série com país
de origem EUA ou Brasil, **ou** `vote_count_tmdb >= 500`, **ou** qualquer linha de
`watch_availability` no Brasil.

| Vitrine da home | Onde | Como o portão entra |
| --- | --- | --- |
| Destaque (hero) | `src/server/home-hero.ts` | filtra os candidatos automáticos depois do portão de qualidade |
| Faixa de novidades ("NOVO", "EM BREVE") | `src/server/home-ticker.ts` | **no SQL**, antes do teto de 60 linhas |
| "Popular essa semana" | `src/server/popular-rankings.ts` | filtra o recorte de cada aba (lista curta) |
| "Filmes em alta" / "Séries da semana" | `src/server/home-catalog.ts` | filtra o trending (topo de 20) |
| "Em breve" | `src/server/home-upcoming.ts` | **no SQL**, antes do `LIMIT` |

O predicado vive em `src/server/home-relevance.ts`, com os números de
`packages/config/src/relevance-gate.ts`. A chave de emergência
`CINERIE_RELEVANCE_GATE=off` vale aqui também.

**O que fica de fora, de propósito:**

- **A curadoria manual do hero** (`hero_curation_decisions`) não passa pelo
  portão. Título fixado por humano entra, como já entrava apesar do portão de
  qualidade.
- **`/pt/filmes/`, `/pt/series/` e `/pt/explorar/`** usam os mesmos getters e
  ficam como estavam: a pergunta foi sobre a home. Estender a elas é uma decisão
  à parte.
- **Nada é apagado e nenhuma página muda de `index`/`noindex`.** O portão só
  decide o que a home destaca.

### Por quê (medido no ar em 13/10/2026)

- O **"NOVO"** logo abaixo do hero era *"Ukryta prawda · T29 · E32 · novo
  episódio hoje"*: uma novela polonesa. A faixa ordena por data e depois por
  `tv_show_id`, então quem exibe episódio todo dia ocupava a faixa por
  frequência.
- O **"Em breve"** abria com *Bir Gecede Kondular* (documentário turco de 45 min),
  *Cosmogonie*, *DARK MACHINE THE ANIMATION* e *Del barro al barrio*: a estreia
  mais próxima do catálogo inteiro, sem filtro nenhum.
- *Bir Gecede Kondular* responde **`noindex, follow`** na própria ficha, pelo
  portão de 24/09. A primeira dobra do site apontava para páginas que o próprio
  site declara fora do índice — o oposto de "curadoria".

## H2 · Episódios continuam como estão

**Decisão.** A sessão propôs tirar do índice as páginas de episódio (~125 mil
URLs no sitemap, cerca de 100 palavras cada: sinopse, data e stills). **O dono
decidiu manter.** O portão de conteúdo de 22/09/2026 continua sendo a regra
(sinopse de 60+ caracteres, imagem própria e série dona no índice).

Fica registrado porque é a alavanca maior que **não** foi usada: se o AdSense
recusar de novo pelo mesmo motivo, ela é a primeira a reabrir. A válvula para
fazê-lo no mesmo dia continua pronta e vazia em
`apps/web/src/server/seo/suspended-pages.ts`.
