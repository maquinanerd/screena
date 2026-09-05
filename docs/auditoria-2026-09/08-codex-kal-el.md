<!-- FASE 2 — REVISAO CEGA do Codex (gpt-5.6-terra, reasoning=high), 2026-09-01 ~05:00.
O Codex NAO teve acesso a nenhum relatorio meu: o screena foi revisado num clone limpo de
origin/main sem docs/auditoria-2026-09; os outros tres nao contem a auditoria.
Comando: codex exec --sandbox read-only --skip-git-repo-check -C <repo> - < <prompt>
Texto integral do modelo, sem edicao de conteudo. -->

Cobertura: abri 50 de 532 arquivos versionados (9,4%).

## 5 achados mais graves

1. **P0 — não existe API pública de leitura/delivery.** O CMS só expõe conteúdo por rotas autenticadas e preview assinado; portanto um portal externo não consegue ler artigo publicado pelo contrato REST. [MEDIDO-CÓDIGO]

2. **P1 — apagar mídia não apaga o binário.** `StorageProvider.delete()` existe, mas tem zero chamadas; o DELETE remove apenas a linha do PostgreSQL. Conteúdo supostamente removido continua no volume, inclusive após exclusões por privacidade. [MEDIDO-CÓDIGO]

3. **P1 — segredos de webhook são armazenados em texto recuperável no banco.** A coluna `webhooks.secret` recebe a chave diretamente e o worker a usa diretamente para assinar; comprometimento de leitura do banco permite forjar callbacks. [MEDIDO-CÓDIGO]

4. **P1 — várias escritas não têm idempotência, contrariando o contrato para automações sob retry.** PATCH/DELETE de taxonomias e mídia, e POST/DELETE de redirects, executam diretamente; timeout ambíguo pode duplicar auditoria, atualizar repetidamente ou transformar sucesso anterior em 404. [MEDIDO-CÓDIGO] [DOC]

5. **P2 — a “reversibilidade” de migrations é um teste enganoso.** O teste chamado de rollback derruba todo o schema com `DROP ... CASCADE`, em vez de executar downgrade de cada migration 0001–0005; ele não prova reversibilidade nem preservação de dados. [MEDIDO-CÓDIGO]

## D1 — estrutura e build

É um monorepo pnpm/TypeScript com API Fastify, CMS Next.js, worker PostgreSQL e packages compartilhados. A API concentra o domínio editorial/RBAC, o worker entrega outbox e publica agendados, e o CMS é um cliente HTTP da API. Há Docker Compose de desenvolvimento e um template de produção; a CI executa format, lint, typecheck, testes, build, audit de dependências e gitleaks. [MEDIDO-CÓDIGO] [DOC]

- Build/teste: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`; CI em [`.github/workflows/ci.yml:35`](<C:/Users/pablo/Documents/OpenCode/Kal El/.github/workflows/ci.yml:35>).
- Dependências principais: Fastify 5, Drizzle/PostgreSQL, Next 14, React 18, Tiptap e Vitest.
- Execução medida: `pnpm test`, `pnpm lint` e `pnpm typecheck` iniciaram, mas terminaram com `spawn EPERM` do Node/Corepack antes de resultado das suítes. Isso não é reprovação de testes do repositório. [MEDIDO-EXECUÇÃO]

## D2 — persistência

Há tabelas para sites, usuários/RBAC/sessões/tokens, artigos/revisões/relações, taxonomias, mídia, auditoria, outbox, idempotência, redirects, webhooks/deliveries e heartbeat. [MEDIDO-CÓDIGO]

- Defaults que podem mascarar decisão editorial ausente: `articles.seo` nasce como `index/follow`; `entities.externalRefs` nasce `[]`; artigo nasce `draft`. [MEDIDO-CÓDIGO] [packages/db/src/schema/editorial.ts:57](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/src/schema/editorial.ts:57>) [packages/db/src/schema/editorial.ts:126](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/src/schema/editorial.ts:126>)
- Há índice parcial correto para publicação agendada: `scheduled_at WHERE status='scheduled'`. [MEDIDO-CÓDIGO] [packages/db/src/schema/editorial.ts:171](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/src/schema/editorial.ts:171>)
- Não medi sistematicamente “colunas que ninguém escreve” em todo o monorepo; o comando que fecha isso é: `git grep -n 'nome_da_coluna' -- apps packages`.
- Migrations são apenas incrementais `ALTER/CREATE`; não há arquivos de down migration. O teste simula rollback destruindo o schema. [MEDIDO-CÓDIGO] [packages/db/tests/migration.test.ts:36](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/tests/migration.test.ts:36>) [packages/db/tests/migration.test.ts:107](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/tests/migration.test.ts:107>)

## D3 — APIs externas

Não encontrei integração de API terceirizada com chave, quota ou cobrança no caminho API/worker auditado. As variáveis sensíveis encontradas são `DATABASE_URL`, `SESSION_SECRET`, `BOOTSTRAP_TOKEN` e segredos de webhook; não exponho valores. [MEDIDO-CÓDIGO]

O tráfego externo real é webhook:

- Timeout: 10 s; retry máximo: 5 por `(webhook,event)`; backoff base: 1 s. [MEDIDO-CÓDIGO] [apps/worker/src/dispatcher.ts:49](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/dispatcher.ts:49>) [apps/worker/src/dispatcher.ts:322](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/dispatcher.ts:322>)
- Como sabe que falhou: status HTTP não-2xx/exceção grava `webhook_deliveries` e, ao esgotar, `failed`. [MEDIDO-CÓDIGO] [apps/worker/src/dispatcher.ts:301](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/dispatcher.ts:301>)
- Custo de uma passagem: lote padrão de 20 eventos × `H` webhooks inscritos = até `20H` POSTs, pois `H` não possui teto global. Ao longo da vida de um evento, até `5H` tentativas. [MEDIDO-CÓDIGO]
- Não há circuit breaker por destino; há backoff e dead-letter por entrega. [MEDIDO-CÓDIGO]

## D4 — filas e jobs

- Cadência: 1 s por padrão, sem ticks sobrepostos. [MEDIDO-CÓDIGO] [apps/worker/src/config.ts:5](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/config.ts:5>) [apps/worker/src/worker.ts:56](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/worker.ts:56>)
- Teto: 20 eventos outbox/tick; 100 artigos agendados/tick. [MEDIDO-CÓDIGO] [apps/worker/src/config.ts:10](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/config.ts:10>)
- A volta, no melhor caso: outbox de `Q` eventos leva pelo menos `ceil(Q/20)` segundos; agendados, `ceil(Q/100)` segundos. Na prática é maior, pois chamadas externas são sequenciais e o próximo tick espera o atual terminar. [INFERIDO a partir do código]
- Idempotência: entrega é ao-menos-uma-vez e envia `x-kal-el-idempotency`; a unicidade é por `(webhook_id,outbox_event_id)`. [MEDIDO-CÓDIGO] [apps/worker/src/dispatcher.ts:229](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/dispatcher.ts:229>)
- O lock de outbox não tem limite seguro: é calculado por `limit × timeout × 2`, mas cada evento pode ter número ilimitado de assinantes e é processado sequencialmente. Sob muitos hooks/lentidão, o lock pode expirar antes do lote acabar e outra réplica reenviar. [INFERIDO] [apps/worker/src/dispatcher.ts:67](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/dispatcher.ts:67>)
- Há dead-letter de webhook, mas não encontrei endpoint de redrive/reprocessamento. [MEDIDO-CÓDIGO]
- **Não dá para provar que o worker rodou ontem se não publicou nada:** `worker_heartbeats` mantém uma única linha sobrescrita a cada tick, sem histórico. [MEDIDO-CÓDIGO] [packages/db/src/schema/system.ts:49](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/src/schema/system.ts:49>) [apps/worker/src/maintenance.ts:28](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/maintenance.ts:28>)

## D5 — saída/frontend

O CMS possui páginas de login, dashboard, artigos, workflow, mídia, taxonomias, autores, sites, usuários, tokens, webhooks, auditoria e preview. O preview usa `no-store` e recebe `noindex,nofollow`. [MEDIDO-CÓDIGO]

O problema estrutural é que a API não tem rota pública equivalente a “artigo publicado por site/slug”: todas as rotas `/v1/sites/:siteId/...` passam por `requireSiteScope`, enquanto as únicas leituras anônimas são health/ready e preview com token. [MEDIDO-CÓDIGO] [apps/api/src/routes/site.ts:87](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/routes/site.ts:87>) [apps/api/src/routes/preview.ts:6](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/routes/preview.ts:6>)

SEO editorial existe no schema (`canonical`, robots, social), mas não há delivery público auditado que o converta em SEO técnico/cache de portal. Estados vazios existem em algumas telas, porém não executei a UI/a11y por causa do `EPERM`; acessibilidade real é **NÃO DETERMINADA**.

## D6 — segurança

Pontos positivos medidos: hash de tokens/sessões, RBAC por site, CSRF para sessão, CORS com allow-list, rate limit, validação de MIME por assinatura, SSRF em criação e entrega de webhook, e secret scanning na CI. [MEDIDO-CÓDIGO]

Superfícies sem autenticação: `/health`, `/ready`, preview por bearer token e `/docs` fora de produção ou quando habilitado. [MEDIDO-CÓDIGO] [apps/api/src/app.ts:85](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/app.ts:85>)

Riscos:

- Webhook secret recuperável no banco. [MEDIDO-CÓDIGO] [packages/db/src/schema/system.ts:126](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/src/schema/system.ts:126>) [apps/api/src/services/webhooks.ts:120](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/services/webhooks.ts:120>)
- Helmet é registrado, mas CSP é explicitamente desligado. Não provei exploração XSS, mas a defesa de navegador não está ativa. [MEDIDO-CÓDIGO] [apps/api/src/app.ts:63](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/app.ts:63>)
- SSRF não parece ser “defesa morta”: a revalidação é chamada imediatamente antes do POST e `guardedFetch` evita rebinding DNS. [MEDIDO-CÓDIGO] [apps/worker/src/dispatcher.ts:267](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/dispatcher.ts:267>)

## D7 — testes

- 49 arquivos de teste e 291 casos detectados por busca sintática. [MEDIDO-CÓDIGO]
- `pnpm test`, lint e typecheck não concluíram devido a `spawn EPERM`; cobertura percentual e status de aprovação são **NÃO DETERMINADOS**. [MEDIDO-EXECUÇÃO]
- Não encontrei `.skip()`/`.only()` nos arquivos de teste enumerados. [MEDIDO-CÓDIGO]
- O teste de migration tem nome e comentário que afirmam reversibilidade, mas valida um reset destrutivo completo seguido de reaplicação. É um teste que dá confiança indevida na regra que deveria guardar. [MEDIDO-CÓDIGO] [packages/db/tests/migration.test.ts:36](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/tests/migration.test.ts:36>) [packages/db/tests/migration.test.ts:107](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/tests/migration.test.ts:107>)

## D8 — dívida

- Código morto: `StorageProvider.delete()` e a implementação local existem, mas há zero chamadas; o parâmetro `storage` em `deleteMedia` não é usado. [MEDIDO-CÓDIGO] [apps/api/src/storage/provider.ts:5](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/storage/provider.ts:5>) [apps/api/src/services/media.ts:222](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/services/media.ts:222>)
- Duplicação: regras de hosts privados estão duplicadas entre API e worker, criando risco de divergência de SSRF. [MEDIDO-CÓDIGO] [apps/api/src/services/webhooks.ts:31](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/services/webhooks.ts:31>) [apps/worker/src/ssrf.ts:4](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/ssrf.ts:4>)
- Números operacionais importantes: 20, 100, 5, 1.000 ms, 10.000 ms e lock mínimo 60.000 ms. Alguns são configuráveis; `LOCK_FLOOR_MS` não é. [MEDIDO-CÓDIGO]
- Há um artefato versionado `RECOVERY-REPORT.md` com 7.076 linhas/293.497 bytes, aparentando duplicar snapshots de código e relatórios; não integra build, mas aumenta ruído de revisão. [MEDIDO-CÓDIGO]

## Tabela de achados

| Gravidade | Achado | Evidência | Consequência |
|---|---|---|---|
| P0 | Sem delivery público | [routes/site.ts:87](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/routes/site.ts:87>), [routes/preview.ts:6](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/routes/preview.ts:6>) — [MEDIDO-CÓDIGO] | Portal externo não consome conteúdo publicado. |
| P1 | Binário órfão após DELETE de mídia | [media.ts:116](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/services/media.ts:116>), [media.ts:264](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/services/media.ts:264>), [provider.ts:5](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/storage/provider.ts:5>) — [MEDIDO-CÓDIGO] | Vazamento de disco/custo e retenção de conteúdo apagado. |
| P1 | Segredo de webhook em texto recuperável | [system.ts:126](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/src/schema/system.ts:126>), [webhooks.ts:120](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/services/webhooks.ts:120>) — [MEDIDO-CÓDIGO] | Leitura do DB permite forjar webhook. |
| P1 | Escritas sem idempotência | [site.ts:429](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/routes/site.ts:429>), [site.ts:503](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/routes/site.ts:503>), [site.ts:583](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/api/src/routes/site.ts:583>) — [MEDIDO-CÓDIGO] [DOC] | Automação sob timeout ambíguo não é segura. |
| P2 | Rollback de migration não testado | [migration.test.ts:36](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/tests/migration.test.ts:36>), [migration.test.ts:107](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/tests/migration.test.ts:107>) — [MEDIDO-CÓDIGO] | Falsa evidência de reversibilidade; rollback real pode falhar/perder dados. |
| P2 | Sem prova histórica de worker | [system.ts:56](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/src/schema/system.ts:56>), [maintenance.ts:28](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/maintenance.ts:28>) — [MEDIDO-CÓDIGO] | Não se demonstra por consulta que o job rodou ontem sem eventos. |
| P2 | Lock de batch não é limite seguro | [dispatcher.ts:67](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/dispatcher.ts:67>) — [INFERIDO] | Sob muitos assinantes, duplicação de entrega entre réplicas. |
| P3 | Comentário contradiz o ator real | [scheduler.ts:183](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/scheduler.ts:183>) e [scheduler.ts:187](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/scheduler.ts:187>) — [MEDIDO-CÓDIGO] | Manutenção induzida a supor `system`, mas o audit grava `worker`. |

## O que está morto

`StorageProvider.delete()` e `LocalStorageProvider.delete()` estão mortos no caminho real. A evidência adicional é busca com zero chamadas `storage.delete(...)`; o serviço recebe `storage` em `deleteMedia`, mas só remove a linha da tabela.

## O que mente

- “Reverse of every applied migration” e o teste “down migration is reversible”: ambos descrevem uma reversão que não existe; o teste executa drop total. [MEDIDO-CÓDIGO] [packages/db/tests/migration.test.ts:36](<C:/Users/pablo/Documents/OpenCode/Kal El/packages/db/tests/migration.test.ts:36>)
- O comentário do scheduler diz que `actorType: "system"` existe para a publicação automática, mas o insert escreve `actorType: "worker"`. [MEDIDO-CÓDIGO] [apps/worker/src/scheduler.ts:183](<C:/Users/pablo/Documents/OpenCode/Kal El/apps/worker/src/scheduler.ts:183>)

## Capacidades CMS: já tem / não tem

Já tem: coleções fixas de artigos, categorias, tags, entidades, autores, fontes, mídia e sites; campos editoriais/SEO; documento rico JSON; upload de imagens raster; login email/senha; sessão, CSRF, RBAC por site e service tokens; drafts/workflow/revisões; preview assinado; auditoria; outbox; webhooks assinados; migrations; publicação agendada com teto de 100 artigos por tick. [MEDIDO-CÓDIGO]

Não tem, no caminho auditado: API pública de leitura de conteúdo publicado; frontend/delivery público com cache/revalidação efetiva; coleções e campos definidos pelo usuário; armazenamento R2/S3; redrive de dead-letter; rollback de migrations validado; retenção/remoção física de mídia; teto global por site/dia para publicação; teto de assinantes por evento. [MEDIDO-CÓDIGO] [INFERIDO]

A funcionalidade efetiva de importação WordPress/Payload é **NÃO DETERMINADA**, pois os packages existem mas não foram lidos/executados nesta auditoria.

## O que não determinei + comando que fecha

- Cobertura de testes e aprovação real: bloqueado por `spawn EPERM`. Fechar em ambiente que permita subprocessos com `pnpm test --coverage && pnpm lint && pnpm typecheck && pnpm build`. <sup>[†]</sup>

> <sup>[†]</sup> **Única edição minha no texto do Codex, declarada.** Ele escreveu
> o comando com o separador `--` antes das flags. O `pnpm 9.15.4` deste
> repositório **não consome** esse separador (ele chega como argumento literal e o
> parser recusa), e existe um teste de governança que proíbe ensiná-lo —
> `tests/governance/no-double-dash-in-docs.test.ts`, cujo regex é
> `/pnpm[^\n]*?\s--\s+--/`. **Ele reprovou este arquivo no CI**, o que é o guard
> funcionando: um relatório vindo de fora não fica isento da governança de quem o
> hospeda. Removi só o separador; o resto da linha é dele.
- UX/a11y visual: `pnpm --filter @kal-el/cms test:e2e`.
- Se há segredos reais no histórico Git: `git log -p --all` mais scanner autorizado; a CI possui gitleaks, mas eu não o executei.
- Integridade do plano de migrations contra banco vazio e upgrade existente: `pnpm --filter @kal-el/db test:integration`.
- Todas as colunas sem escritor e todo código morto: análise de referências para cada símbolo/schema, por exemplo `git grep -n 'primaryDomain' -- apps packages`.
- Segurança prática de XSS sem CSP: teste de renderização com payload editor e navegador real.

## Três perguntas extras

1. **Defeito mais grave:** o produto se anuncia API-first para portais, mas não expõe nenhuma API pública de leitura de conteúdo publicado.

2. **O que parece funcionar e não funciona?** A remoção de mídia parece completa no CMS e no banco, porém o arquivo físico persiste porque o adaptador de storage nunca recebe `delete()`.

3. **O que um auditor da Anthropic provavelmente não perceberia?** A abstração de storage parece madura — tem interface, implementação local e validação de caminho — mas justamente a operação mais crítica dessa interface está desconectada do fluxo real de exclusão.

## O que não abri

Não abri 482 arquivos versionados, incluindo a maior parte dos componentes/páginas CMS, contratos completos/OpenAPI, editor Tiptap, importer WordPress/Payload, SDK, fixture, design-system, documentação operacional e a maioria dos 49 arquivos de testes. Não tratei esses caminhos como evidência; as conclusões acima se limitam aos arquivos listados e aos comandos executados.
