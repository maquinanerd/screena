# CLOUDPANEL_DEPLOY — Deploy do Screen em VPS com CloudPanel

> Documento operacional de deploy. Descreve como colocar o Screen no ar em
> um VPS gerenciado pelo CloudPanel: site Node.js (`thescreen.media`),
> PostgreSQL, Redis opcional, servicos offline via `systemd`, proxy reverso
> Nginx e SSL do CloudPanel. Em caso de conflito entre este documento e a
> realidade do servidor, atualize este documento ou corrija o servidor —
> nunca deixe os dois divergentes em silencio.

> **Estado atual:** este guia e procedimento de referencia para deploy publico
> do Screen em `https://thescreen.media`. Os comandos continuam
> ilustrativos e nao devem ser executados automaticamente por nenhum agente.
> Nomes antigos `screena-*` podem aparecer como legado tecnico interno, mas nao
> representam a marca publica nem o dominio canonico.

Invariantes reforcados por este documento:

- **Invariante 3** — Zero API externa no render: as paginas publicas
  indexaveis leem apenas PostgreSQL/cache local. Os workers que falam com
  APIs externas rodam **offline**, via `systemd` timers, nunca no caminho do
  request.
- **Invariante 4** — Zero Gemini no render: a IA (Gemini) so roda no worker
  `entity-writer`, offline, gravando em `content_blocks`.
- **Complementar** — API keys so em variaveis de ambiente, nunca no
  frontend. Veja a secao [Variaveis de ambiente](#variaveis-de-ambiente).

---

## 1. Visao geral da arquitetura de deploy

```
                      Internet (HTTPS 443)
                              |
                   +----------v-----------+
                   |   Nginx (CloudPanel) |  proxy reverso + SSL
                   |   thescreen.media    |  (Let's Encrypt)
                   +----------+-----------+
                              | http://127.0.0.1:3000
                   +----------v-----------+
                   |  Next.js (Node 22)   |  the-screen-web.service
                   |  @screena/web        |  ISR/revalidate, RSC
                   +----+------------+----+
                        |            |
              leitura   |            | cache
            (somente)   |            |
                 +------v---+   +----v-------+
                 | Postgres |   |   Redis    |  (opcional)
                 |  local/  |   |  cache/    |
                 | gerencia |   |  filas     |
                 +----^-----+   +----^-------+
                      |              |
        escrita       |              | (offline, nunca no render)
        offline       |              |
            +---------+--------------+----------+
            |     Servicos offline (systemd)    |
            |  TS/Node: tmdb · entity-writer    |
            |  Python roadmap: ratings ·        |
            |  streaming · rssprime             |
            |  orquestrados por scheduler.timer |
            +-----------------------------------+
```

Pontos inegociaveis desta topologia:

- O **Next.js so le** PostgreSQL e o cache (Redis/local). Ele **nunca**
  chama TMDB, Gemini, provedor de ratings ou provedor de streaming durante o
  render.
- Os **servicos offline** sao os unicos que falam com APIs externas. Hoje,
  TMDB/ingestao/sync e Entity Writer rodam em TypeScript/Node + Prisma; workers
  Python permanecem como roadmap/shim para ratings, streaming, RSS/news e
  orquestracao. Todos rodam fora do request, escrevem no banco/cache e geram log
  de todo sync (`api_sync_logs`) quando ha contato externo.
- O **CloudPanel** cuida do Nginx (proxy reverso) e do SSL. Nao expomos a
  porta 3000 diretamente na internet.

---

## 2. Componentes

| Componente | Papel | Como roda | Exposicao |
| --- | --- | --- | --- |
| **Site Node.js** | App Next.js (`@screena/web`), serve `thescreen.media` | Node 22, porta interna `3000`, via PM2 ou `systemd` | Interno (`127.0.0.1:3000`), so o Nginx alcanca |
| **PostgreSQL** | Banco canonico (filmes, series, ratings, content_blocks...) | Local no VPS **ou** gerenciado (provedor externo) | Interno; nunca exposto a internet publica |
| **Redis (opcional)** | Cache de leitura e fila leve de jobs dos workers | Local no VPS ou gerenciado | Interno; protegido por senha + bind local |
| **Servicos offline** | Sync TMDB, ratings/streaming futuros, RSS futuro e Entity Writer (Gemini offline) | TS/Node atual para TMDB/Entity Writer; Python 3.12 como roadmap/shim; via `systemd` services + timers | Sem porta publica; saida apenas para APIs externas e banco |
| **Nginx (CloudPanel)** | Proxy reverso HTTPS -> `127.0.0.1:3000`, gzip/brotli, headers | Gerenciado pela UI/CLI do CloudPanel | Publico nas portas 80/443 |
| **SSL (CloudPanel)** | Certificado Let's Encrypt para `thescreen.media` e `www` | Emitido/renovado pelo CloudPanel | Termina TLS no Nginx |

### 2.1 Site Node.js (`thescreen.media`, porta 3000)

- App: `apps/web` (`@screena/web`), Next.js App Router em modo `standalone`.
- Porta interna fixa: **3000** (`PORT=3000`), escutando apenas em
  `127.0.0.1`.
- Servido sob o usuario do site criado no CloudPanel (ex.: `screena`), nunca
  como `root`.

### 2.2 PostgreSQL (local ou gerenciado)

- **Local:** instancia PostgreSQL no proprio VPS, escutando em
  `127.0.0.1:5432`, acessada via `DATABASE_URL`.
- **Gerenciado:** instancia em provedor externo; nesse caso `sslmode=require`
  na connection string e o IP do VPS liberado no firewall do provedor.
- Em ambos os casos, o banco **nunca** aceita conexao publica aberta.

### 2.3 Redis (opcional)

- Usado para cache de leitura das paginas (acelera ISR) e como fila leve dos
  workers.
- Se ausente, o app cai para cache local (em memoria/arquivo) sem perder
  funcionalidade.
- Protegido por `requirepass` e `bind 127.0.0.1`.

### 2.4 Servicos offline (via systemd)

- TMDB/ingestao/sync e Entity Writer rodam hoje em **TypeScript/Node + Prisma**.
- Esqueletos Python 3.12 permanecem como roadmap/shim futuro para ratings,
  streaming, RSS/news e orquestracao. Cada worker/servico offline pode ser um
  `*.service` do tipo `oneshot`, disparado por um `*.timer` (ou pelo
  `the-screen-scheduler.timer`).
- Responsaveis por **todo** contato com APIs externas. Sempre geram log de sync
  quando ha sincronizacao externa.

### 2.5 Nginx (proxy reverso do CloudPanel)

- O CloudPanel gera o vhost Nginx do site Node.js automaticamente.
- Faz proxy `https://thescreen.media` -> `http://127.0.0.1:3000`.
- Trata compressao, headers de seguranca e cache de assets estaticos.

### 2.6 SSL do CloudPanel

- Let's Encrypt emitido e renovado pela UI/CLI do CloudPanel.
- Cobrir `thescreen.media` e `www.thescreen.media` (redirect `www` -> apex).
- Forcar HTTPS (redirect 80 -> 443).

---

## 3. Passos de deploy (1 a 18)

> Os blocos de shell sao **ilustrativos**. Ajuste usuario, caminhos e
> versoes ao seu ambiente. Nada aqui deve ser executado por um agente
> automatizado na Fase 0.

### Passo 1 — Provisionar o VPS

Crie um VPS (Ubuntu 22.04/24.04 LTS recomendado, minimo sugerido 2 vCPU /
4 GB RAM / 40 GB SSD para o MVP). Garanta acesso SSH com chave (nao senha) e
um usuario `sudo` dedicado.

```bash
# no seu host local: gere/parametrize a chave e teste o acesso
ssh -i ~/.ssh/screena_vps deploy@<IP_DO_VPS>
```

### Passo 2 — Instalar o CloudPanel

Instale o CloudPanel seguindo o instalador oficial para a sua distro. Apos a
instalacao, acesse o painel em `https://<IP_DO_VPS>:8443` e crie o usuario
administrador.

```bash
# exemplo ilustrativo do instalador oficial (confira a doc do CloudPanel)
curl -sS https://installer.cloudpanel.io/ce/v2/install.sh -o install.sh
sudo bash install.sh
```

### Passo 3 — Criar o site Node.js no CloudPanel

No CloudPanel: **Sites -> Add Site -> Create a Node.js Site**.

- Domain: `thescreen.media`
- Node.js version: **22 LTS**
- App Port: **3000**
- Site user: `screena` (anote o usuario; o app rodara sob ele)

O CloudPanel cria o vhost Nginx com proxy reverso para `127.0.0.1:3000`.

### Passo 4 — Apontar o dominio (DNS)

No provedor de DNS de `thescreen.media`, crie os registros:

```
A      thescreen.media        -> <IP_DO_VPS>
A      www.thescreen.media    -> <IP_DO_VPS>      (ou CNAME -> thescreen.media)
```

Aguarde a propagacao antes de emitir SSL (Passo 13).

### Passo 5 — Criar o banco PostgreSQL

No CloudPanel: **Databases -> Add Database** (ou crie direto via `psql` se
usar instancia gerenciada).

- Database name: `screen_prod`
- Charset/encoding: `UTF8`

### Passo 6 — Criar o usuario do banco

Crie um usuario dedicado com permissao apenas no `screen_prod`.

```sql
-- ilustrativo
CREATE USER screen_app WITH PASSWORD '<SENHA_FORTE>';
GRANT ALL PRIVILEGES ON DATABASE screen_prod TO screen_app;
```

A senha entra **apenas** em `DATABASE_URL` (nunca commitada).

### Passo 7 — Clonar o repositorio via SSH

Como usuario do site (`screena`), clone o monorepo no diretorio do site. Use
deploy key de leitura.

```bash
sudo su - screena
cd ~/htdocs/thescreen.media
git clone git@github.com:<org>/screena.git releases/$(date +%Y%m%d%H%M%S)
ln -sfn releases/<timestamp> current   # symlink "current" aponta para o release ativo
cd current
```

A estrategia de **release folders** (`releases/<timestamp>` + symlink
`current`) viabiliza o rollback do Passo 18.

### Passo 8 — Configurar `.env.production`

Crie `.env.production` **fora do controle de versao**, legivel apenas pelo
usuario do site. Veja a secao [Variaveis de ambiente](#variaveis-de-ambiente).

```bash
install -m 600 /dev/null ~/htdocs/thescreen.media/shared/.env.production
nano ~/htdocs/thescreen.media/shared/.env.production
# o release "current" recebe um symlink para o .env compartilhado:
ln -sfn ../shared/.env.production current/apps/web/.env.production
```

> Segredos vivem em `shared/` (fora dos releases) para sobreviver a deploys e
> nunca serem versionados.

### Passo 9 — Rodar as migrations

O schema Prisma e as migrations reais vivem em `packages/db/prisma`. Rode as
migrations antes de subir o app contra um release novo.

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
pnpm --filter @screena/db db:generate
pnpm --filter @screena/db db:migrate:deploy
```

Migrations sempre rodam **antes** de apontar o symlink `current` para o novo
release, para evitar app novo contra schema velho.

### Passo 10 — Buildar o Next.js

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
pnpm --filter @screena/web build           # build do app publico Next.js
```

Garanta `output: 'standalone'` no `next.config` para um bundle de runtime
enxuto.

### Passo 11 — Subir o app (PM2 ou systemd)

**Opcao A — `systemd` (recomendado, ver unit na secao 5):**

```bash
sudo systemctl enable --now the-screen-web.service
sudo systemctl status the-screen-web.service
```

**Opcao B — PM2:**

```bash
pm2 start "node apps/web/.next/standalone/server.js" --name the-screen-web \
  --cwd ~/htdocs/thescreen.media/current
pm2 save
pm2 startup     # gera o hook de boot
```

Escolha **uma** estrategia e padronize. Este guia prioriza `systemd`.

### Passo 12 — Criar os systemd timers dos servicos offline

Instale os `*.service` e `*.timer` dos workers (secao 5) e habilite o
agendador.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now the-screen-scheduler.timer
sudo systemctl list-timers 'the-screen-*'
```

### Passo 13 — Ativar o SSL (CloudPanel)

No CloudPanel: **Sites -> thescreen.media -> SSL/TLS -> New Let's Encrypt
Certificate**, incluindo `thescreen.media` e `www.thescreen.media`. Ative o
redirect HTTP -> HTTPS.

### Passo 14 — Configurar backup

- **Banco:** dump diario do PostgreSQL para diretorio versionado/retido.
- **Segredos e uploads:** backup de `shared/` (inclui `.env.production`).
- Replique os backups para fora do VPS (object storage).

```bash
# ilustrativo: dump diario via cron/systemd timer
pg_dump "$DATABASE_URL" | gzip > /var/backups/screena/db-$(date +%F).sql.gz
```

### Passo 15 — Firewall

Libere apenas o necessario; o resto fica fechado.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp        # SSH (restrinja por IP quando possivel)
sudo ufw allow 80/tcp        # HTTP (redirect -> HTTPS)
sudo ufw allow 443/tcp       # HTTPS
sudo ufw allow 8443/tcp      # painel CloudPanel (restrinja por IP)
sudo ufw enable
```

A porta **3000 nunca e exposta** — so o Nginx (local) a alcanca. PostgreSQL
(5432) e Redis (6379) ficam fechados na internet.

### Passo 16 — Logs

- **App:** `journalctl -u the-screen-web.service` (ou logs do PM2).
- **Workers:** `journalctl -u the-screen-worker-*.service`.
- **Nginx:** logs do site no CloudPanel.
- **Sync externo:** alem do log do sistema, todo sync grava em
  `api_sync_logs` (regra de auditoria do projeto).

```bash
journalctl -u the-screen-web.service -f
journalctl -u 'the-screen-worker-*' --since "1 hour ago"
```

### Passo 17 — Criar staging em subdominio

Replique o ambiente em `staging.thescreen.media` com **banco e segredos
separados**.

- Site Node.js separado no CloudPanel, porta interna distinta (ex.: `3001`).
- `THE_SCREEN_PUBLIC_SITE_URL=https://staging.thescreen.media`.
- Banco `screena_staging` e `.env.production` proprios.
- **noindex** no staging (coerente com a regra de paginas em draft).

### Passo 18 — Rollback por release folder

Como cada deploy vive em `releases/<timestamp>` e `current` e um symlink,
o rollback e instantaneo: re-apontar `current` para o release anterior e
reiniciar o servico.

```bash
cd ~/htdocs/thescreen.media
ln -sfn releases/<timestamp_anterior> current
sudo systemctl restart the-screen-web.service
```

> Se o release com problema rodou migrations destrutivas, o rollback de
> codigo **nao** desfaz o schema. Prefira migrations aditivas/compativeis e
> tenha o dump do Passo 14 a mao.

---

## 4. Lista de processos / servicos

| Unit | Tipo | Funcao | Disparo |
| --- | --- | --- | --- |
| `the-screen-web.service` | `simple` (long-running) | App Next.js (`@screena/web`) na porta 3000 | Boot / `systemctl` |
| `the-screen-worker-tmdb.service` | `oneshot` | Sync de metadados TMDB (filmes, series, pessoas) | `the-screen-scheduler.timer` |
| `the-screen-worker-ratings.service` | `oneshot` | Coleta de ratings externos (com atribuicao e licenca) | `the-screen-scheduler.timer` |
| `the-screen-worker-streaming.service` | `oneshot` | Disponibilidade "onde assistir" por pais | `the-screen-scheduler.timer` |
| `the-screen-worker-entity-writer.service` | `oneshot` | Entity Writer (Gemini offline) gerando `content_blocks` | `the-screen-scheduler.timer` |
| `the-screen-worker-rssprime.service` | `oneshot` | Ingestao de RSS/noticias (RSS Prime) | `the-screen-scheduler.timer` |
| `the-screen-scheduler.timer` | `timer` | Orquestra/encadeia os workers acima em janelas agendadas | Calendario do `systemd` |

Notas:

- Os workers `*.service` sao `oneshot`: executam, terminam e voltam a dormir
  ate o proximo disparo do timer. Nada de loop infinito em request.
- O `entity-writer` e o **unico** que invoca Gemini, e **so offline**: le
  payload controlado do PostgreSQL, gera `content_blocks` (com
  `prompt_version`, `input_hash`, `output_hash`, `model_provider`,
  `model_name`, `review_status`) e nunca publica sozinho.
- Cada worker grava log de sync em `api_sync_logs`.

---

## 5. Exemplos de units systemd (ilustrativos)

> Arquivos de exemplo. Ajuste `User`, `WorkingDirectory`, caminhos do
> virtualenv e `OnCalendar`. Segredos vem do `EnvironmentFile`, nunca
> inline no unit.

### 5.1 `the-screen-web.service` (app Next.js)

```ini
# /etc/systemd/system/the-screen-web.service
[Unit]
Description=Screen Web (Next.js) - thescreen.media
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=screen
WorkingDirectory=/home/screen/htdocs/thescreen.media/current
EnvironmentFile=/home/screen/htdocs/thescreen.media/shared/.env.production
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node apps/web/.next/standalone/server.js
Restart=on-failure
RestartSec=5
# Hardening basico
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### 5.2 `the-screen-worker-tmdb.service` (servico TS/Node oneshot)

```ini
# /etc/systemd/system/the-screen-worker-tmdb.service
[Unit]
Description=Screen Service - TMDB sync (offline)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=oneshot
User=screen
WorkingDirectory=/home/screen/htdocs/thescreen.media/current
EnvironmentFile=/home/screen/htdocs/thescreen.media/shared/.env.production
ExecStart=/usr/bin/corepack pnpm --filter @screena/sync exec tsx bin/run.ts
NoNewPrivileges=true
PrivateTmp=true
```

> TMDB/ingestao/sync rodam hoje em TypeScript/Node. Workers futuros de
> `ratings`, `streaming` e `rssprime` podem usar Python 3.12 como shim/roadmap
> quando forem implementados; `entity-writer` tambem roda hoje em TS/Node e deve
> continuar offline.

### 5.3 `the-screen-scheduler.timer` (+ service de orquestracao)

```ini
# /etc/systemd/system/the-screen-scheduler.service
[Unit]
Description=Screen Scheduler - encadeia os workers offline

[Service]
Type=oneshot
User=screen
# dispara os workers na ordem correta (TMDB -> ratings -> streaming ...)
ExecStart=/usr/bin/systemctl start --wait the-screen-worker-tmdb.service
ExecStart=/usr/bin/systemctl start --wait the-screen-worker-ratings.service
ExecStart=/usr/bin/systemctl start --wait the-screen-worker-streaming.service
ExecStart=/usr/bin/systemctl start --wait the-screen-worker-rssprime.service
ExecStart=/usr/bin/systemctl start --wait the-screen-worker-entity-writer.service
```

```ini
# /etc/systemd/system/the-screen-scheduler.timer
[Unit]
Description=Screen Scheduler timer (janelas de sync offline)

[Timer]
# exemplo: a cada 6 horas, com jitter para evitar pico
OnCalendar=*-*-* 00/6:00:00
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
```

---

## 6. Bloco Nginx ilustrativo (proxy reverso)

> O CloudPanel **gera e gerencia** este vhost automaticamente ao criar o site
> Node.js. O bloco abaixo serve apenas para entendimento; nao edite o arquivo
> do CloudPanel a mao sem necessidade.

```nginx
# vhost ilustrativo (gerado pelo CloudPanel) - thescreen.media
server {
    listen 443 ssl http2;
    server_name thescreen.media www.thescreen.media;

    # SSL gerenciado pelo CloudPanel (Let's Encrypt)
    ssl_certificate     /etc/nginx/ssl-certificates/thescreen.media.crt;
    ssl_certificate_key /etc/nginx/ssl-certificates/thescreen.media.key;

    # Redireciona www -> apex
    if ($host = www.thescreen.media) {
        return 301 https://thescreen.media$request_uri;
    }

    # Headers de seguranca basicos
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Assets estaticos do Next.js com cache longo
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 365d;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Proxy reverso para o app Node.js (porta interna 3000)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# Redireciona HTTP -> HTTPS
server {
    listen 80;
    server_name thescreen.media www.thescreen.media;
    return 301 https://thescreen.media$request_uri;
}
```

---

## 7. Variaveis de ambiente

> **AVISO DE SEGURANCA (inegociavel).** Todas as chaves abaixo vivem
> **somente** em variaveis de ambiente do servidor (`.env.production` em
> `shared/`, `0600`, fora do controle de versao). **Nunca** sao expostas ao
> frontend, **nunca** vao para o bundle do cliente, **nunca** sao commitadas
> e **nunca** aparecem em paginas indexaveis. Apenas
> `THE_SCREEN_PUBLIC_SITE_URL` e publica (URL canonica do site); todas as demais
> sao **segredos de servidor** lidos apenas pelo app server e pelos workers.

| Variavel | Usada por | Publica? | Descricao |
| --- | --- | --- | --- |
| `DATABASE_URL` | web (leitura) + workers (escrita) | Nao | Connection string do PostgreSQL (`postgres://user:pass@host:5432/screen_prod`). Em banco gerenciado, inclua `?sslmode=require`. |
| `THE_SCREEN_PUBLIC_SITE_URL` | web | **Sim** | URL canonica publica (`https://thescreen.media`). Usada em canonicals, sitemap, OG. |
| `TMDB_READ_ACCESS_TOKEN` | worker/service `tmdb` | Nao | Token Bearer v4 do TMDB (preferido; tem precedencia quando preenchido). So o pipeline offline usa; nunca o render. |
| `TMDB_API_KEY` | worker/service `tmdb` | Nao | Chave v3 do TMDB (fallback quando `TMDB_READ_ACCESS_TOKEN` estiver ausente). So o pipeline offline usa; nunca o render. |
| `GEMINI_API_KEY` | worker/service `entity-writer` | Nao | Chave do Gemini. So o Entity Writer offline a usa (Invariante 4). |
| `GEMINI_MODEL` | worker/service `entity-writer` | Nao | Modelo Gemini usado pelo Entity Writer offline. |
| `SCREENA_RATINGS_PROVIDER_KEY` | worker `ratings` | Nao | Chave do provedor tecnico de ratings (`provider_api`), distinto da fonte editorial (Invariante 2). |
| `SCREENA_STREAMING_PROVIDER_KEY` | worker `streaming` | Nao | Chave do provedor de disponibilidade "onde assistir". |
| `SCREENA_REDIS_URL` | web (cache) + workers (fila) | Nao | URL do Redis (`redis://:senha@127.0.0.1:6379/0`). Opcional; se ausente, cai para cache local. |

### 7.1 Exemplo de `.env.production` (valores fictícios)

```dotenv
# /home/screen/htdocs/thescreen.media/shared/.env.production  (chmod 600)

# --- Banco ---
DATABASE_URL=postgres://screen_app:TROQUE_ESTA_SENHA@127.0.0.1:5432/screen_prod

# --- Publico (unica variavel exposta ao cliente) ---
THE_SCREEN_PUBLIC_SITE_URL=https://thescreen.media

# --- Segredos de servidor (NUNCA no frontend) ---
TMDB_READ_ACCESS_TOKEN=coloque_o_token_v4_aqui
TMDB_API_KEY=coloque_a_chave_v3_aqui
GEMINI_API_KEY=coloque_a_chave_aqui
GEMINI_MODEL=gemini-3.1-flash-lite
SCREENA_RATINGS_PROVIDER_KEY=coloque_a_chave_aqui
SCREENA_STREAMING_PROVIDER_KEY=coloque_a_chave_aqui

# --- Cache/fila (opcional) ---
SCREENA_REDIS_URL=redis://:TROQUE_ESTA_SENHA@127.0.0.1:6379/0
```

> Apenas variaveis explicitamente publicas (ex.: `THE_SCREEN_PUBLIC_SITE_URL`)
> podem ser expostas ao cliente via prefixo de build do Next. Toda chave de
> API (`*_API_KEY`, `*_PROVIDER_KEY`) e segredo de servidor e jamais recebe
> esse prefixo.

---

## 8. Checklist final de deploy

- [ ] VPS provisionado, SSH por chave, usuario `sudo` dedicado.
- [ ] CloudPanel instalado e admin criado.
- [ ] Site Node.js criado (Node 22, porta 3000, usuario `screen`).
- [ ] DNS de `thescreen.media` e `www` apontando para o VPS.
- [ ] Banco `screen_prod` e usuario `screen_app` criados.
- [ ] Repo clonado em `releases/<timestamp>`, symlink `current` ativo.
- [ ] `.env.production` em `shared/` (`0600`), fora do git.
- [ ] Migrations Prisma aplicadas.
- [ ] Build do Next.js (`standalone`) concluido.
- [ ] `the-screen-web.service` ativo, escutando em `127.0.0.1:3000`.
- [ ] Timers dos servicos offline habilitados; `entity-writer` so offline.
- [ ] SSL Let's Encrypt emitido; redirect HTTP -> HTTPS e `www` -> apex.
- [ ] Backups (banco + `shared/`) agendados e replicados para fora do VPS.
- [ ] Firewall: so 22/80/443/8443; 3000/5432/6379 fechados na internet.
- [ ] Logs verificados (`journalctl` + `api_sync_logs`).
- [ ] Staging em `staging.thescreen.media` com banco/segredos proprios e
      `noindex`.
- [ ] Procedimento de rollback por release folder testado.
