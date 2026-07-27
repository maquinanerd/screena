# Decisões de Produto — User Product Platform (Backend C)

> Registro canônico das decisões de produto da plataforma de usuários
> (auth + tracking + listas + ratings + reviews + histórico + recomendações).
> Este documento é **pré-requisito da migration**: nenhum schema irreversível
> foi criado antes destas decisões estarem registradas. Idioma: pt-BR.
> Código e identificadores em inglês.

Estado: decisões v1 registradas em 2026-07-17, na macrofase Backend C
(PR draft `feat/user-product-platform`). Alterar qualquer decisão daqui exige
novo registro datado nesta página (append, nunca sobrescrever silenciosamente).

---

## 1. Escala de avaliação (rating)

- **0,5 a 5,0 estrelas, passo 0,5** (10 valores possíveis).
- A escala é fixa (`scale = 5`) e gravada por linha para permitir migração
  futura sem reinterpretar valores antigos.
- Constraint no banco (CHECK): `value >= 0.5`, `value <= 5` e
  `value * 2 = floor(value * 2)` — o passo de 0,5 é lei do banco, não só da UI.
- **Rating de usuário nunca vira rating externo**: `user_ratings` é uma tabela
  própria, sem nenhuma relação com `external_ratings` (invariantes 1 e 2 — 
  IMDb != Rotten Tomatoes; `provider_api` != `rating_source`). Nenhuma média de
  usuários é exibida como se fosse nota de fonte externa, e vice-versa.
- **Sem `AggregateRating` de usuários no schema.org por enquanto**: agregado
  próprio só após política editorial + amostra mínima definidas por humano
  (regra complementar "Sem AggregateRating falsa"). O schema suporta calcular,
  o produto não publica.

## 2. Privacidade por padrão

- **Perfil privado por padrão** (`ProfileVisibility = private`).
- **Listas privadas por padrão** (`Visibility = private`).
- Diário/histórico, watch state e reviews nascem **privados**.
- Visibilidades: `private` (só o dono), `unlisted` (quem tem o link),
  `public` (visível e, no futuro, elegível a superfície pública).
- **Nada privado ou unlisted entra em página indexável, sitemap ou payload
  público** — superfícies de usuário privadas são `noindex` por construção
  (coerente com a invariante 5: `noindex` técnico) e ficam fora do sitemap.
- Lista **pública** só para usuário com e-mail verificado (antiabuso).

## 3. Estados de acompanhamento (watch state)

Enum canônico `WatchState`:

`planned` · `watching` · `watched` · `paused` · `dropped` · `rewatching` · `not_interested`

- Um estado por (usuário, entidade) — `@@unique([userId, entityId])`.
- `not_interested` existe para alimentar exclusão em recomendações, não é
  exibido como atividade.
- Marcar episódio pode **derivar** progresso da série (nunca destrutivamente:
  derivação só promove `planned → watching` e `watching → watched` quando
  todos os episódios conhecidos estiverem vistos; nunca rebaixa estado nem
  apaga datas preenchidas pelo usuário).
- **Optimistic locking** via coluna `version` + header `Expected-Version` na
  borda de serviço: escrita com versão defasada falha com conflito explícito,
  nunca sobrescreve silenciosamente.
- Desfazer (undo) restaura estado mas **preserva o evento no histórico/audit**
  (o diário é append-only; o estado atual é projeção mutável).

## 4. Diário / histórico

- **Estado atual != evento**: `user_watch_states` guarda a projeção atual;
  `viewing_events` guarda o histórico append-only (com `idempotency_key` por
  usuário para reprocessamento seguro).
- Diário público é uma **visão filtrada** dos eventos cujo dono optou por
  visibilidade pública — nunca o log bruto.
- Review e rating são objetos próprios, ligados à entidade, não ao evento.

## 5. Reviews

- Review com **flag de spoiler obrigatória** (`containsSpoiler`).
- Corpo em texto puro/markdown limitado (sanitização na borda; nunca HTML cru).
- Moderação: `pending → approved | rejected`; conteúdo reportável; soft delete
  (`deletedAt`) preservando audit.
- Anti-spam: rate limit por usuário, limite de tamanho, limite de links UGC,
  `rel="ugc nofollow"` quando algum link for renderizado no futuro.
- Reviews de usuário **não** são `Review` editorial do Screen no schema.org —
  superfície pública de reviews de usuário é decisão futura separada.

## 6. Social

- **v1 sem social avançado**: sem follow/feed/comentários/likes.
- v1 inclui apenas os primitivos de segurança: `report` (denúncia) e `block`
  (bloqueio 1→1), porque moderação sem eles não funciona.
- Qualquer feed social é macrofase futura com decisão própria.

## 7. LGPD / ciclo de vida de dados

- **Consentimento registrado** (`consent_records`) com versão de política.
- **Exportação**: o usuário pode solicitar export completo dos seus dados
  (JSON/CSV) — fluxo assíncrono auditado (`data_requests`).
- **Exclusão**: solicitação de exclusão → desativação imediata da conta →
  janela de arrependimento → **anonimização** (dados pessoais removidos;
  agregados estatísticos anônimos podem ser retidos conforme política).
- Retenção e prazos documentados em `docs/privacy/data-lifecycle.md`.
- Dados sensíveis **nunca** vão para analytics; IP bruto não é persistido
  (apenas hash com sal de servidor, para brute-force/audit).

## 8. Autenticação

- **E-mail + senha** no v1. OAuth **não** é inventado agora: o schema já
  comporta adapters (`accounts` com `provider` + `provider_account_id`), mas
  nenhum provedor é ativado sem decisão humana registrada.
- Hash de senha: **scrypt via `node:crypto`** (biblioteca madura, nativa do
  Node, parâmetros OWASP: N=2^15, r=8, p=1, keylen=64, sal de 16 bytes por
  senha) — escolhido em vez de Argon2id para evitar dependência nativa
  (prebuilds por plataforma) no CI/VPS. Formato PHC-like versionado
  (`scrypt$N=32768,r=8,p=1$<salt>$<hash>`) permite migrar para Argon2id no
  futuro com re-hash em login.
- Sessões opacas: token aleatório de 256 bits entregue ao cliente; o banco
  guarda **apenas o hash** (SHA-256). Rotação de sessão em login/elevação;
  revogação individual e "revoke all".
- Tokens de verificação de e-mail e reset de senha: single-use, com hash no
  banco, expiração curta, consumo atômico (replay-safe); token nunca aparece
  em URL logada após consumo.
- Brute force: janela deslizante por `email_normalized` e por hash de IP, com
  lockout progressivo; respostas **sem enumeração** (mesma resposta para
  e-mail existente ou não).
- Cookies (quando a borda HTTP for ligada): `HttpOnly; Secure; SameSite=Lax;
  Path=/`, nome com prefixo `__Host-` em produção.
- CSRF: double-submit token vinculado à sessão para toda mutação.
- Auditoria: todo evento de auth (signup, login ok/falha, logout, reset,
  verificação, revogação, lockout) gera linha em `auth_audit_logs` — senha e
  token **nunca** aparecem em log.

## 9. Recomendações v1

- Sinais: gêneros (afinidade), histórico, ratings do usuário, similares já
  persistidos no catálogo, popularidade/trending por país.
- **Exclusões obrigatórias**: entidades `watched` (salvo `rewatching`),
  `not_interested` e bloqueadas por licença.
- Diversidade: cap por franquia/gênero no snapshot.
- **Snapshot persistido com explicação**: cada recomendação gravada com
  `RecommendationReason` (por que apareceu) e `algorithm_version` — nunca
  recalculada no request de render (zero trabalho pesado no request; zero API
  externa no render — invariante 3).

## 10. Estatísticas

- Projeções **assíncronas** (minutos, filmes, episódios, gêneros, décadas,
  streak, avaliações, listas) materializadas em snapshot por usuário.
- Nenhum cálculo pesado no request; o render lê o snapshot pronto.

## 11. Importação / exportação

- Adapters v1: **Letterboxd CSV**, **Trakt export (JSON)**, **Cinerie
  JSON/CSV** (formato próprio, também usado no export LGPD).
- Fluxo obrigatório: `uploaded → parsed → preview → resolve → conflicts →
  apply`. **Nunca** aplicar sem preview aprovado pelo usuário; aplicação é
  idempotente (re-aplicar não duplica) e nunca rebaixa dado local sem
  confirmação explícita de conflito.

## 12. Adaptações às convenções do repositório (registradas)

A missão esboçou modelos com `id String`; o repositório usa **BigInt
autoincrement** como PK interna em todo o schema (decisão D6 da Fase 1) — os
modelos de usuário seguem o repo. Demais adaptações conscientes:

- `avatarAssetId` → `avatar_path` (não existe tabela de assets; caminho local,
  nunca URL externa no render).
- `Visibility`/`ProfileVisibility` são enums Postgres próprios; visibilidade
  de UGC tem `unlisted` além de `private`/`public`.
- Watch state é por **filme/série** (`entity_type IN ('movie','tv')` no CHECK);
  temporada/episódio usam `user_episode_progress`. Rating/review aceitam
  movie/tv/season/episode e **nunca** `person` (CHECK).
- **DTOs com validadores TS puros** (padrão `packages/schemas`) em vez de Zod:
  o repositório não tem Zod e a governança padroniza validação pura
  hand-rolled com mensagens pt-BR. Adotar Zod fica registrado como decisão
  futura separada (novo dep de runtime exige revisão humana).
- Tabelas prefixadas `user_*` (exceto `users`) para isolar o domínio de
  usuário do domínio editorial/catálogo.
- FK polimórfica real para o registry `entities(entity_type, entity_id)` nas
  tabelas que apontam para o catálogo (padrão do hardening 2026-07).

## 13. Fora de escopo desta macrofase

- UI visual (o frontend não é alterado; borda HTTP fica atrás de camada de
  serviço transport-agnostic).
- Payload CMS, notícias, social avançado, `AggregateRating` de usuários,
  OAuth ativo, notificações.
- Merge: a PR é **draft** e só avança com revisão humana.

---

## Registro 2026-07-27 (C8 — listas, watchlist, tracker, importação)

> Prompt 08 tornou a camada pessoal **funcional** (runtime + borda HTTP + UI
> mínima). Estas decisões refinam/corrigem os registros v1 acima; arquitetura
> executável detalhada em [`user-product-library.md`](user-product-library.md).

### 13.1 Watchlist × favorites × `UserWatchState` (canônico)

- **`UserWatchState` é a fonte canônica** de "quero assistir / assistindo /
  assistido". A **watchlist do produto é `status = planned`** — não existe tabela
  de watchlist separada. O botão de entidade (filme/série) e "Minha lista" leem e
  escrevem `user_watch_states`.
- **`SystemListKey` (`watchlist`, `favorites`, `watching`, `watched`) são listas
  de sistema** — coleções nomeadas, um eixo **separado** do watch state, para
  curadoria e futura superfície social. **`favorites` existe só como lista de
  sistema**; não há estado "favorito" no enum `WatchState`. Marcar favorito é
  adicionar à lista `favorites`, nunca mudar o watch state.
- Os dois eixos **não se sincronizam automaticamente**: mudar o watch state para
  `watched` não move nada para a lista de sistema `watched`, e vice-versa. Fato de
  progresso ≠ curadoria.

### 13.2 Formatos de importação REALMENTE suportados

- C8 implementa **`cinerie_csv`** (match exato por `tmdb_id`/`imdb_id`) e
  **`letterboxd_csv`** (título+ano, nunca auto-aplicado). **Corrige** o registro
  v1 §11: **Trakt export (JSON)** e IMDb **não** estão implementados e **não** são
  oferecidos na UI — não prometemos formato que o código não parseia. Ficam como
  trabalho futuro separado.
- **Arquivos comprimidos/binários são recusados por assinatura** (ZIP, GZIP, RAR,
  7Z, PDF): não abrimos ZIP (elimina zip-bomb/path-traversal de uma vez). O export
  do Letterboxd vem em ZIP → o usuário extrai o CSV antes de enviar.

### 13.3 Matching fail-closed; zero entidade inventada

- Só `exact` (id externo único) é auto-aplicado. `high_confidence` (título+ano
  único) exige confirmação; `ambiguous`/`not_found` **não** são aplicados.
- A importação **nunca cria entidade de catálogo** para uma linha sem
  correspondência. Não há filme/série fantasma: linha sem match fica registrada
  como não-aplicável no preview.

### 13.4 Aplicação idempotente, retomável e isolada

- Fluxo `upload → parse → normalize → match → conflicts → preview (zero escrita) →
  apply`. Nunca aplica sem preview.
- Idempotente (uniques de destino), **nunca rebaixa** estado/nota local — a
  política anti-rebaixamento é **re-derivada atomicamente no apply** (não só no
  preview): `planned` importado é insert-only (`ON CONFLICT DO NOTHING`, nunca
  rebaixa `watched`); `watched` só promove; nota do arquivo é insert-only
  (`insertIfAbsent`, nunca sobrescreve a nota do dono). Fecha o TOCTOU entre
  preview e apply e o arquivo com a mesma entidade em dois estados.
- Retomável por cursor (`applied_count`), com **CAS de status** (`preview_ready →
  applying`) elegendo um vencedor entre dois `apply` concorrentes.
- `apply`/`cancel`/`read` são **por titular** (ownership do servidor, nunca do
  corpo).

### 13.5 Exportação LGPD serializável (correção)

- O export inclui as superfícies novas (watch states, progresso, listas+itens,
  notas, histórico, metadados de jobs) e passa por **`toJsonSafe`** (`BigInt →
  string`, `Decimal → string`, `Date → ISO`). Sem isso, qualquer usuário com
  biblioteca quebrava o export — bug real capturado no PostgreSQL 16 e hoje
  travado por teste. Segredos (hash de senha/CSRF/token/IP, sessões) **nunca**
  entram no payload.

### 13.6 Encerramento executa a retenção

- `product_content = delete` em `DATA_CLASSIFICATION` é **executado**:
  `purgeForUser` apaga a biblioteca do titular no encerramento; consentimento e
  pedidos LGPD (`retain_indefinitely`) permanecem. Purga é **por titular** e não
  toca outro usuário.

### 13.7 Ação explícita ≠ tracking opcional

- Os serviços de biblioteca **nunca** chamam `hasActiveConsent`: watchlist,
  assistido, tracker, listas e importação são ações explícitas do usuário e não
  podem ser bloqueadas por recusa de telemetria opcional.
