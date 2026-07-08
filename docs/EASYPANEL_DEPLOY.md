# EASYPANEL_DEPLOY — Deploy do Screen em VPS com EasyPanel + Nixpacks

> Documento operacional de deploy **atual/canonico**. Descreve como colocar o
> Screen no ar em um VPS (Contabo) gerenciado pelo **EasyPanel**, com build via
> **Nixpacks**: app Next.js (`thescreen.media`), PostgreSQL, servicos offline e
> proxy reverso + SSL geridos pelo EasyPanel. Em caso de conflito entre este
> documento e a realidade do servidor, atualize este documento ou corrija o
> servidor — nunca deixe os dois divergentes em silencio.

> **Estado atual.** EasyPanel + Nixpacks e o caminho de deploy **ativo**.
> [`docs/CLOUDPANEL_DEPLOY.md`](./CLOUDPANEL_DEPLOY.md) (CloudPanel + Nginx +
> PM2/systemd) e **referencia historica** — a arquitetura logica (pureza de
> render, workers offline, segredos so em env) e a mesma; muda a camada de
> orquestracao. Os comandos abaixo sao **ilustrativos** e nao devem ser
> executados automaticamente por nenhum agente. Nomes antigos `screena-*` podem
> aparecer como legado tecnico interno, nunca como marca publica.

Invariantes reforcadas por este documento:

- **Invariante 3 — Zero API externa no render.** As paginas publicas leem
  apenas PostgreSQL/cache local. Os workers que falam com APIs externas rodam
  **offline**, nunca no caminho do request.
- **Invariante 4 — Zero Gemini no render.** A IA (Gemini) so roda no worker
  `entity-writer`, offline, gravando em `content_blocks`.
- **Complementar — API keys so em variaveis de ambiente de runtime**, nunca no
  frontend nem em **build-args** (Nixpacks: use env de runtime, nao de build,
  para segredos). Veja [Variaveis de ambiente](#7-variaveis-de-ambiente).

---

## 1. Visao geral da arquitetura de deploy

```
                      Internet (HTTPS 443)
                              |
                   +----------v-----------+
                   |  EasyPanel (Traefik) |  proxy reverso + SSL
                   |   thescreen.media    |  (Let's Encrypt automatico)
                   +----------+-----------+
                              | http://<app>:3000
                   +----------v-----------+
                   |  Next.js (Node 22)   |  app "screen-web" (Nixpacks)
                   |  @screena/web        |  ISR/revalidate, RSC, standalone
                   +----+------------+----+
                        |            |
              leitura   |            | cache
            (somente)   |            | (local/opcional)
                 +------v---+   +----v-------+
                 | Postgres |   |  cache     |
                 | (servico |   |  local     |
                 |  EasyPanel|  |            |
                 |  ou ext.)|   +------------+
                 +----^-----+
                      |
        escrita       | (offline, nunca no render)
        offline       |
            +---------+-----------------------+
            |  Servicos offline (agendados)   |
            |  TS/Node: tmdb · entity-writer  |
            |  Python roadmap: ratings ·      |
            |  streaming · rssprime           |
            +---------------------------------+
```

Pontos inegociaveis desta topologia:

- O **Next.js so le** PostgreSQL e cache local. **Nunca** chama TMDB, Gemini,
  provedor de ratings ou de streaming durante o render.
- Os **servicos offline** sao os unicos que falam com APIs externas. Hoje,
  TMDB/ingestao/sync e Entity Writer rodam em TypeScript/Node + Prisma; workers
  Python permanecem como roadmap/shim. Todos rodam fora do request e geram log
  de todo sync (`api_sync_logs`) quando ha contato externo.
- O **EasyPanel** cuida do proxy reverso (Traefik) e do SSL (Let's Encrypt). A
  porta 3000 do app nunca e exposta diretamente na internet.

---

## 2. Componentes

| Componente | Papel | Como roda | Exposicao |
| --- | --- | --- | --- |
| **App web** | Next.js (`@screena/web`), serve `thescreen.media` | Nixpacks (Node 22, pnpm), porta interna `3000`, Next `standalone` | Interno; so o Traefik do EasyPanel alcanca |
| **PostgreSQL** | Banco canonico (filmes, series, ratings, content_blocks...) | Servico Postgres do EasyPanel **ou** instancia gerenciada externa | Interno; nunca exposto a internet publica |
| **Servicos offline** | Sync TMDB, ratings/streaming futuros, RSS futuro e Entity Writer (Gemini offline) | TS/Node hoje; Python 3.12 como roadmap; agendados (cron/scheduled task) | Sem porta publica; saida so para APIs externas e banco |
| **Traefik (EasyPanel)** | Proxy reverso HTTPS -> `app:3000`, compressao, headers | Gerenciado pela UI do EasyPanel | Publico nas portas 80/443 |
| **SSL (EasyPanel)** | Certificado Let's Encrypt para `thescreen.media` (+ `www`) | Emitido/renovado automaticamente pelo EasyPanel | Termina TLS no Traefik |

### 2.1 App web (`thescreen.media`, porta 3000)

- App: `apps/web` (`@screena/web`), Next.js App Router.
- Build via **Nixpacks**, que detecta `package.json` + `packageManager`
  (`pnpm@9.15.4`). Por ser **monorepo pnpm com workspaces**, o Nixpacks
  provavelmente precisa de comandos de build/start explicitos (ver secao 3) para
  buildar somente `@screena/web` e iniciar o servidor `standalone`.
- Porta interna fixa: **3000** (`PORT=3000`). Recomenda-se `output: 'standalone'`
  no `next.config` para um bundle de runtime enxuto.

### 2.2 PostgreSQL (servico EasyPanel ou gerenciado)

- **Servico EasyPanel:** crie um servico Postgres no mesmo projeto; o app o
  alcanca pela rede interna do projeto via `DATABASE_URL`.
- **Gerenciado:** instancia externa; use `?sslmode=require` na connection string
  e libere o IP do VPS no firewall do provedor.
- Em ambos os casos, o banco **nunca** aceita conexao publica aberta.

### 2.3 Servicos offline (agendados)

- TMDB/ingestao/sync e Entity Writer rodam hoje em **TypeScript/Node + Prisma**.
- Esqueletos Python 3.12 permanecem como roadmap/shim para ratings, streaming,
  RSS/news e orquestracao.
- Executam como **tarefas agendadas** (scheduled task do EasyPanel, cron do host,
  ou `systemd` timer — a escolha depende de como o VPS foi montado). Sao
  `oneshot`: rodam, terminam e voltam a dormir; nada de loop em request.
- Responsaveis por **todo** contato com APIs externas; sempre geram log de sync.

---

## 3. Build Nixpacks (monorepo pnpm)

O Nixpacks detecta o stack automaticamente, mas o monorepo com workspaces exige
comandos explicitos para nao tentar buildar/rodar a raiz. Configure na UI do
EasyPanel (campos de Build/Start) ou via `nixpacks.toml`/variaveis; ajuste ao seu
ambiente:

```bash
# Install (usa o pnpm fixado em packageManager, via Corepack)
corepack enable
pnpm install --frozen-lockfile

# Migrations ANTES de promover o release (schema em packages/db/prisma)
pnpm --filter @screena/db db:generate
pnpm --filter @screena/db db:migrate:deploy

# Build do app publico
pnpm --filter @screena/web build

# Start (servidor standalone do Next na porta 3000)
node apps/web/.next/standalone/apps/web/server.js
# (confirme o caminho exato do server.js gerado pelo build standalone no monorepo)
```

> **Caveats do monorepo no Nixpacks.** (1) O caminho do `server.js` no modo
> `standalone` dentro de um monorepo pode diferir de `apps/web/.next/standalone/server.js`
> — verifique o output do build. (2) O `standalone` precisa dos assets estaticos
> (`.next/static`) e de `public/` copiados ao lado do server; confirme que o
> runtime os encontra. (3) Segredos entram como **env de runtime**, nunca como
> build-arg do Nixpacks.

---

## 4. Passos de deploy (resumo)

> Passos ilustrativos; ajuste nomes de projeto/servico e caminhos a UI do
> EasyPanel. Nada aqui deve ser executado por um agente automatizado.

1. **Provisionar o VPS** (Contabo, Ubuntu LTS) e **instalar o EasyPanel**
   (instalador oficial). Acesse o painel e crie o admin.
2. **Criar um projeto** no EasyPanel (ex.: `screen`).
3. **Criar o servico PostgreSQL** no projeto (ou apontar para instancia
   gerenciada). Anote host/porta/credenciais internos.
4. **Criar o app** (`screen-web`): fonte = repositorio Git (deploy key de
   leitura), branch `main`. Builder = **Nixpacks**. Porta interna = **3000**.
5. **Configurar Build/Start** conforme a secao 3 (build filtrado + start
   standalone).
6. **Configurar as variaveis de ambiente** (secao 7) como env de **runtime**.
7. **Apontar o dominio**: no EasyPanel, adicione `thescreen.media` (e `www`) ao
   app; no DNS, aponte `A thescreen.media -> <IP_DO_VPS>` (e `www`). O EasyPanel
   emite o SSL Let's Encrypt automaticamente.
8. **Rodar as migrations** contra o banco de producao **antes** do primeiro
   release servir trafego (`db:migrate:deploy`).
9. **Deploy** (build + start). Confirme o app escutando em `:3000` internamente
   e respondendo via `https://thescreen.media`.
10. **Agendar os servicos offline** (TMDB/entity-writer) como tarefas
    `oneshot`; garantir que `entity-writer` roda **so offline**.
11. **Backups, firewall e logs** (secoes 5, 6 e pendencias).

---

## 5. Firewall

Libere apenas o necessario; o resto fica fechado.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp        # SSH (restrinja por IP quando possivel)
sudo ufw allow 80/tcp        # HTTP (redirect -> HTTPS pelo Traefik)
sudo ufw allow 443/tcp       # HTTPS
# porta do painel EasyPanel: restrinja por IP conforme sua instalacao
sudo ufw enable
```

A porta **3000 nunca e exposta** — so o Traefik (interno) a alcanca. PostgreSQL
fica fechado na internet.

---

## 6. Logs

- **App e servicos:** logs de cada servico na UI do EasyPanel (stdout/stderr do
  container). Para deploy Nixpacks fora de container, use o log do processo/host.
- **Sync externo:** alem do log do runtime, **todo** sync grava em
  `api_sync_logs` (regra de auditoria do projeto).

---

## 7. Variaveis de ambiente

> **AVISO DE SEGURANCA (inegociavel).** Todas as chaves abaixo vivem **somente**
> em variaveis de ambiente **de runtime** do servidor/servico. **Nunca** vao para
> o frontend, para o bundle do cliente, para **build-args** do Nixpacks nem sao
> commitadas. So a URL canonica publica pode ser exposta ao cliente.

| Variavel | Usada por | Publica? | Descricao |
| --- | --- | --- | --- |
| `DATABASE_URL` | web (leitura) + workers (escrita) | Nao | Connection string do PostgreSQL. Em banco gerenciado, inclua `?sslmode=require`. |
| `NODE_ENV` | web + workers | Nao | `production`. |
| `TMDB_READ_ACCESS_TOKEN` | worker `tmdb` | Nao | Token Bearer v4 do TMDB (preferido). So o pipeline offline usa; nunca o render. |
| `TMDB_API_KEY` | worker `tmdb` | Nao | Chave v3 do TMDB (fallback). So offline. |
| `GEMINI_API_KEY` | worker `entity-writer` | Nao | Chave do Gemini. So o Entity Writer offline a usa (Invariante 4). |
| `GEMINI_MODEL` | worker `entity-writer` | Nao | Modelo Gemini do Entity Writer. |
| Chaves de ratings/streaming (RapidAPI) | workers futuros | Nao | `provider_api`, distinto da `rating_source` (Invariante 2). So offline, quando as features forem ativadas. |

> **Limitacao conhecida — URL canonica hardcoded.** Hoje o dominio publico e
> **hardcoded** em [`apps/web/src/lib/site.ts`](../apps/web/src/lib/site.ts)
> (`SITE_URL = "https://thescreen.media"`), **nao** lido de env. Consequencia:
> qualquer dominio temporario/staging serve canonicals/sitemap apontando para
> `thescreen.media`. Antes de expor um dominio temporario indexavel, tornar a
> URL canonica configuravel por env (ex.: `THE_SCREEN_PUBLIC_SITE_URL`) e
> garantir `noindex` no staging.

---

## 8. Pendencias de operacao production-grade

Itens ainda **nao** implementados (rastreados no `README.md` e nos relatorios de
status em `docs/`), a fechar antes de considerar o deploy maduro:

- [ ] **Migration no release**: aplicar `db:migrate:deploy` de forma controlada e
      ordenada (antes de promover), idealmente como passo do pipeline.
- [ ] **Backup do PostgreSQL**: dump periodico replicado para fora do VPS.
- [ ] **Healthcheck**: endpoint/HTTP check antes de promover o release.
- [ ] **URL canonica por env** (ver secao 7) + `noindex` garantido em staging.
- [ ] **Staging** em subdominio com banco/segredos proprios e `noindex`.
- [ ] **Rollback** documentado/testado para o modelo de deploy do EasyPanel.

---

## 9. Checklist final de deploy

- [ ] VPS provisionado; EasyPanel instalado; admin criado.
- [ ] Projeto `screen` criado; servico PostgreSQL no ar (ou gerenciado).
- [ ] App `screen-web` criado (Nixpacks, Git `main`, porta 3000).
- [ ] Build/Start configurados para o monorepo (build filtrado + start standalone).
- [ ] Variaveis de ambiente definidas como **runtime** (nenhum segredo em build-arg).
- [ ] DNS de `thescreen.media` (+ `www`) apontando; SSL Let's Encrypt emitido.
- [ ] Migrations Prisma aplicadas **antes** do release servir trafego.
- [ ] App respondendo em `https://thescreen.media`; porta 3000 nao exposta.
- [ ] Servicos offline agendados; `entity-writer` so offline; sync grava `api_sync_logs`.
- [ ] Firewall: so 22/80/443 (+ painel restrito); Postgres fechado na internet.
- [ ] Pendencias da secao 8 acompanhadas ate fechar.
