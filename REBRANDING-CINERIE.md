# Gate 1.5 — Rebranding Screen → Cinerie

> Relatório do Gate 1.5. **Nenhuma funcionalidade foi adicionada e nenhum
> comportamento foi alterado**: este gate troca identidade, nomenclatura,
> branding e documentação.

- **Branch:** `feat/gate-1.5-cinerie-rebranding` (base: `main` @ `63a889f`)
- **Data:** 2026-07-16
- **Marca:** `Screen` / `The Screen` → **Cinerie**
- **Domínio:** `https://thescreen.media` → **`https://cinerie.com`**

## Totais

| Métrica | Valor |
| --- | --- |
| Arquivos alterados | **157** |
| Linhas | +771 / −495 |
| Marca `Cinerie` introduzida | **287** ocorrências em **122** arquivos |
| Domínio `cinerie.com` introduzido | **144** ocorrências em **49** arquivos |
| Ocorrências internas mantidas (deliberado) | **1.593** |
| Testes | **2132/2132** verdes |

> As duas linhas de ocorrências excluem este relatório, que fala *sobre* o
> rebranding e não é rebranding.

## O que mudou

**Marca pública**
- Header/footer (`Cinerie`), `aria-label`, `<title>`/template, `openGraph.siteName`.
- Home: `HOME_TITLE`, `HOME_H1`, descrição, `Organization.name`,
  `WebSite.name`, `Organization.logo`, `aria-label` da nav.
- Descrições de filmes/séries/pessoas/notícias/busca/explorar.
- Badge/label neutro em `packages/ui` (`Vertical.label`/`badge`).
- `ADMIN_BASIC_AUTH_REALM`: `Screen Admin` → `Cinerie Admin`.
- **Screen Score → Cinerie Score** no texto de exibição (o campo/coluna NÃO
  muda — ver "mantidas").

**Domínio**
- `OFFICIAL_SITE_URL` em `apps/web/src/lib/site.ts` → `https://cinerie.com`.
- Canonical, JSON-LD, OG/Twitter, sitemap, robots, `.env.example`, Dockerfile,
  README, ADRs, runbooks, rules, skills, templates de SEO.

**Logos** (`apps/web/public/brand/`)
- `screen-logo-*.svg` (6) → `cinerie-logo-*.svg` (4).
- ⚠️ **O wordmark é provisório e precisa de design.** O logo antigo era
  `SCR` + caixa + `N` = **SCREEN**, com a caixa substituindo o “EE” e
  representando uma tela. Esse trocadilho **era a palavra “Screen”**: não há
  equivalente para “Cinerie”, e inventar um símbolo novo é design, não
  rebranding. Os arquivos atuais são um wordmark textual honesto
  (`CINERIE`, Montserrat 900, `textLength` para não quebrar com fallback de
  fonte). Ver `apps/web/public/brand/README.md`.
- As variantes `-cinema-white` / `-series-white` foram removidas: existiam só
  porque a COR vivia na caixa; sem a caixa seriam idênticas às de acento.

**Documentação**
- `THE_SCREEN.md` → **`CINERIE.md`** (links atualizados).
- README, CLAUDE.md, AGENTS.md, `.claude/rules/*`, `.claude/agents/*`,
  `.claude/skills/*`, ADRs, runbooks, `docs/backend/*`, `docs/contracts/*`,
  `seo/templates/*`, prompts.
- As declarações de política de marca foram **reescritas**, não substituídas: a
  troca mecânica produzia absurdos como *“Cinerie pode aparecer apenas como
  referência histórica”*. Agora dizem que **Screen/The Screen/thescreen.media
  são a marca e o domínio anteriores**.

## Onde a substituição mecânica errou (corrigido)

Um `sed` global de marca **falsifica** texto. Quatro erros foram encontrados na
revisão do próprio gate e corrigidos; ficam registrados porque são exatamente o
que uma revisão de rebranding deve procurar:

1. **Asserção negativa invertida** — `tests/web/robots.test.ts` verificava que a
   saída do `robots.txt` **não** contém a marca legada `"The Screen"`. A troca
   mecânica transformou o teste em “não contém **Cinerie**”: passou a proibir a
   marca **atual**. Ele ficava verde por acidente (o robots não emite a marca) e
   deixava de guardar o que devia. Restaurado para guardar os legados
   (`screena.media`, `thescreen.media`, `"The Screen"`).
2. **Migration já aplicada** — o comentário de
   `migrations/20260706120000_add_certification_screen_score/migration.sql` foi
   editado. O Prisma guarda o **checksum do arquivo** em `_prisma_migrations` e
   aborta o `migrate deploy` se ele mudar — inclusive por um comentário. Migration
   aplicada é registro imutável: **revertida**, nenhuma migration é tocada (§7).
3. **História falsificada** — a passagem de domínio reescreveu o **corpo** dos 5
   snapshots datados, gerando frases impossíveis como *“A solicitação atual define
   a marca pública como **Screen** e o domínio canônico como `cinerie.com`”* numa
   auditoria de 2026-07-01, contradizendo a própria nota de cabeçalho.
   Corpos **restaurados byte a byte** de `origin/main`; cada snapshot só **ganha**
   a nota (5 arquivos, +50 linhas, 0 remoções).
4. **Nome de arquivo real tratado como marca** — `Screen Screens v4.dc.html` é o
   **nome literal** do artefato canônico de design (existe no pacote, com SHA-256
   registrado). Renomeá-lo para `Cinerie Screens v4.dc.html` em `DIVERGENCIAS.md`,
   `FASE-0-RELATORIO.md` e `RELATORIO-PORT-CANONICO.md` apontava os relatórios
   para um arquivo inexistente. Nome literal **restaurado**.

## Ocorrências MANTIDAS (e por quê)

Conforme §7/§8 do gate: nada de migration, nada de renomear tabela, nada de
alterar comportamento.

| Ocorrência | Qtd. | Por que fica |
| --- | ---: | --- |
| `@screena/*` (nomes de pacote) | 945 | Namespace técnico/legado interno. Renomear tocaria todo import, lockfile e `tsconfig`/`vitest` paths — alto risco, zero ganho de marca (nunca é exibido). |
| `--screena-*` (tokens CSS) | 105 | Idem: contrato interno de estilo, não texto público. |
| `screenScore` (campo Prisma) | 217 | §8 permite explicitamente. Renomear exigiria `@map` + varrer todos os usos; a coluna continuaria `screen_score`. |
| `screen_score` (coluna) | 222 | Renomear = **migration** — proibido pelo §7. |
| `SCREEN_SCORE_*` (constantes) | 23 | Acopladas ao campo/coluna acima. |
| `screened_theatrically` | 4 | **Campo da API do TMDB**, não nosso. Renomear quebraria a ingestão. |
| `THE_SCREEN_PUBLIC_*` (env) | 77 | Ver abaixo — mantidas como **fallback**. |

### Variáveis de ambiente: renomeadas COM fallback

`CINERIE_PUBLIC_SITE_URL` e `CINERIE_PUBLIC_INDEXING_ENABLED` passam a ser os
nomes canônicos. Os nomes antigos (`THE_SCREEN_PUBLIC_*`) **continuam sendo
lidos como fallback**, com o nome novo tendo precedência.

Motivo: renomear a env sem fallback quebraria **todo deploy já configurado**
(EasyPanel/Dockerfile) no instante do merge — o site perderia a origem oficial e
`isOfficialIndexableEnvironment()` passaria a bloquear o crawl. Um gate de
rebranding não pode alterar comportamento. Migrar a configuração dos ambientes e
remover o fallback é trabalho de um gate de infraestrutura.

Coberto por teste: só-legado funciona; ambos definidos ⇒ o novo vence.

### Snapshots históricos preservados

Estes 5 documentos são registros datados de auditorias passadas. Eles contêm
achados **sobre a marca antiga** — por exemplo: *“a UI usa ‘The Screen’ em 5
pontos, violando CLAUDE.md §1”* — além de datas, branches e commits de então.
Reescrevê-los falsificaria o registro (ver erro 3 acima). Cada um recebeu **só**
uma nota de cabeçalho:

- `docs/SCREEN_MASTER_PROJECT_AUDIT_AND_PRODUCT_ROADMAP.md`
- `docs/THE_SCREEN_CURRENT_STATE_AUDIT.md`
- `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md`
- `docs/SITE_BACKEND_API_PRODUCT_AUDIT_BEFORE_DESIGN_RESET.md`
- `docs/PUBLIC_DESIGN_RESET_REPORT.md`

Isso segue o §10 (“preservar comentários históricos quando fizer sentido”).

## Correção de brinde: teste de CRLF

`tests/web/public-navigation.test.ts` afirmava a marca com um literal
`'>\n          Screen\n        </a>'`. Como o teste lê o arquivo **do disco**, e
o checkout Windows usa CRLF (`core.autocrlf=true`, repo sem `.gitattributes`),
ele **falhava só no Windows** havia meses (verde no CI Linux). Como o gate
mexia justamente nessa asserção, ela virou regex tolerante a espaço/quebra
(`/>\s*Cinerie\s*<\/a>/`) — a intenção do teste é “a marca é TEXTO, não um
logo”, não a indentação exata.

Resultado: **a suíte fica 2132/2132 no Windows**, o que não acontecia antes.

## Riscos

| Risco | Severidade | Mitigação |
| --- | --- | --- |
| Deploy sem `CINERIE_PUBLIC_SITE_URL` | **Alta** se não houvesse fallback | Fallback para `THE_SCREEN_PUBLIC_*` implementado e testado. **Ação humana:** migrar as envs no EasyPanel e, depois, remover o fallback. |
| Domínio `cinerie.com` não registrado/apontado | **Alta** | Fora do escopo do código. **Ação humana:** registrar o domínio, DNS, TLS e redirect 301 de `thescreen.media` → `cinerie.com` antes de indexar. |
| Logo provisório | Média | Wordmark textual honesto; sinalizado no README dos assets. **Ação humana:** design final. |
| Marca antiga indexada no Google | Média | 301 + `Organization`/`WebSite` atualizados. Monitorar Search Console. |
| `screenScore`/`screen_score` divergindo da marca | Baixa | Interno, nunca exibido. Migrar em gate de infraestrutura. |
| Teste `tmdb-provider-separation` flaky | Baixa | **Pré-existente**, não causado por este gate: varre o disco (~4-5s) e falha esporadicamente só em execução paralela no Windows; passa isolado e no CI Linux. Registrado para investigação separada. |

## Validação

| Gate | Resultado |
| --- | --- |
| `pnpm typecheck` | ✅ |
| `pnpm typecheck:catalog-runtime` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm test` | ✅ **2132/2132** |
| `pnpm audit:invariants` | ✅ PASSOU |
| `pnpm audit:render` | ✅ PASSOU |
| `pnpm api:coverage` | ✅ PASSOU |
| `pnpm validate:all` | ✅ 100% das asserções |
| `pnpm build` | ✅ |
| `git diff --check` | ✅ |

## Auditoria final

Busca global por `Screen`, `screen`, `The Screen`, `thescreen`,
`thescreen.media`, classificando cada ocorrência. **Nenhuma referência pública
antiga permanece como identidade ativa.** Restam 17 ocorrências de
`thescreen.media`, todas corretas:

- **4** declarações de política que *dizem* que ele é o domínio anterior
  (`CLAUDE.md`, `AGENTS.md`, `README.md`, `.claude/rules/seo.md`);
- **6** neste relatório;
- **5** nas notas de cabeçalho dos snapshots;
- **2** em testes que **guardam a ausência** do domínio legado
  (`robots.test.ts`, `admin-preview-pages.test.ts`).

## Próximo passo

Após revisão e merge: **Macrofase 2** (Ratings, Streaming, Cinerie Score e
Licenças). Nenhuma linha da Macrofase 2 foi iniciada neste gate.
