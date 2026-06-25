# CLOUDPANEL_DEPLOY — Deploy da Screena em VPS com CloudPanel

> Documento operacional de deploy. Descreve como colocar a Screena no ar em
> um VPS gerenciado pelo CloudPanel: site Node.js (`screena.media`),
> PostgreSQL, Redis opcional, workers Python via `systemd`, proxy reverso
> Nginx e SSL do CloudPanel. Em caso de conflito entre este documento e a
> realidade do servidor, atualize este documento ou corrija o servidor —
> nunca deixe os dois divergentes em silencio.

> **Fase 0 (fundacao):** este guia e o procedimento de referencia. Os
> comandos sao ilustrativos e nao devem ser executados automaticamente por
> nenhum agente. Builds reais, migrations reais e segredos reais entram nas
> fases seguintes. Nada aqui instala dependencia, roda migration ou publica
> sozinho.

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
                   |   screena.media      |  (Let's Encrypt)
                   +----------+-----------+
                              | http://127.0.0.1:3000
                   +----------v-----------+
                   |  Next.js (Node 22)   |  screena-web.service
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
            |        Workers Python (systemd)   |
            |  tmdb · ratings · streaming ·     |
            |  entity-writer · rssprime         |
            |  orquestrados por scheduler.timer |
            +-----------------------------------+
```

Pontos inegociaveis desta topologia:

- O **Next.js so le** PostgreSQL e o cache (Redis/local). Ele **nunca**
  chama TMDB, Gemini, provedor de ratings ou provedor de streaming durante o
  render.
- Os **workers Python** sao os unicos que falam com APIs externas. Eles
  rodam de forma agendada (timers do `systemd`), escrevem no banco/cache e
  geram log de todo sync (`api_sync_logs`).
- O **CloudPanel** cuida do Nginx (proxy reverso) e do SSL. Nao expomos a
  porta 3000 diretamente na internet.

---

## 2. Componentes

| Componente | Papel | Como roda | Exposicao |
| --- | --- | --- | --- |
| **Site Node.js** | App Next.js (`@screena/web`), serve `screena.media` | Node 22, porta interna `3000`, via PM2 ou `systemd` | Interno (`127.0.0.1:3000`), so o Nginx alcanca |
| **PostgreSQL** | Banco canonico (filmes, series, ratings, content_blocks...) | Local no VPS **ou** gerenciado (provedor externo) | Interno; nunca exposto a internet publica |
| **Redis (opcional)** | Cache de leitura e fila leve de jobs dos workers | Local no VPS ou gerenciado | Interno; protegido por senha + bind local |
| **Workers Python** | Sync TMDB, ratings, streaming, RSS e Entity Writer (Gemini offline) | Python 3.12 em virtualenv, via `systemd` services + timers | Sem porta publica; saida apenas para APIs externas e banco |
| **Nginx (CloudPanel)** | Proxy reverso HTTPS -> `127.0.0.1:3000`, gzip/brotli, headers | Gerenciado pela UI/CLI do CloudPanel | Publico nas portas 80/443 |
| **SSL (CloudPanel)** | Certificado Let's Encrypt para `screena.media` e `www` | Emitido/renovado pelo CloudPanel | Termina TLS no Nginx |

### 2.1 Site Node.js (`screena.media`, porta 3000)

- App: `apps/web` (`@screena/web`), Next.js App Router em modo `standalone`.
- Porta interna fixa: **3000** (`PORT=3000`), escutando apenas em
  `127.0.0.1`.
- Servido sob o usuario do site criado no CloudPanel (ex.: `screena`), nunca
  como `root`.

### 2.2 PostgreSQL (local ou gerenciado)

- **Local:** instancia PostgreSQL no proprio VPS, escutando em
  `127.0.0.1:5432`, acessada via `SCREENA_DATABASE_URL`.
- **Gerenciado:** instancia em provedor externo; nesse caso `sslmode=require`
  na connection string e o IP do VPS liberado no firewall do provedor.
- Em ambos os casos, o banco **nunca** aceita conexao publica aberta.

### 2.3 Redis (opcional)

- Usado para cache de leitura das paginas (acelera ISR) e como fila leve dos
  workers.
- Se ausente, o app cai para cache local (em memoria/arquivo) sem perder
  funcionalidade.
- Protegido por `requirepass` e `bind 127.0.0.1`.

### 2.4 Workers Python (via systemd)

- Esqueletos Python 3.12 (Fase 0). Cada worker e um `*.service` do tipo
  `oneshot`, disparado por um `*.timer` (ou pelo `screena-scheduler.timer`).
- Responsaveis por **todo** contato com APIs externas. Sempre geram log de
  sync.

### 2.5 Nginx (proxy reverso do CloudPanel)

- O CloudPanel gera o vhost Nginx do site Node.js automaticamente.
- Faz proxy `https://screena.media` -> `http://127.0.0.1:3000`.
- Trata compressao, headers de seguranca e cache de assets estaticos.

### 2.6 SSL do CloudPanel

- Let's Encrypt emitido e renovado pela UI/CLI do CloudPanel.
- Cobrir `screena.media` e `www.screena.media` (redirect `www` -> apex).
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

- Domain: `screena.media`
- Node.js version: **22 LTS**
- App Port: **3000**
- Site user: `screena` (anote o usuario; o app rodara sob ele)

O CloudPanel cria o vhost Nginx com proxy reverso para `127.0.0.1:3000`.

### Passo 4 — Apontar o dominio (DNS)

No provedor de DNS de `screena.media`, crie os registros:

```
A      screena.media        -> <IP_DO_VPS>
A      www.screena.media    -> <IP_DO_VPS>      (ou CNAME -> screena.media)
```

Aguarde a propagacao antes de emitir SSL (Passo 13).

### Passo 5 — Criar o banco PostgreSQL

No CloudPanel: **Databases -> Add Database** (ou crie direto via `psql` se
usar instancia gerenciada).

- Database name: `screena_prod`
- Charset/encoding: `UTF8`

### Passo 6 — Criar o usuario do banco

Crie um usuario dedicado com permissao apenas no `screena_prod`.

```sql
-- ilustrativo
CREATE USER screena_app WITH PASSWORD '<SENHA_FORTE>';
GRANT ALL PRIVILEGES ON DATABASE screena_prod TO screena_app;
```

A senha entra **apenas** em `SCREENA_DATABASE_URL` (nunca commitada).

### Passo 7 — Clonar o repositorio via SSH

Como usuario do site (`screena`), clone o monorepo no diretorio do site. Use
deploy key de leitura.

```bash
sudo su - screena
cd ~/htdocs/screena.media
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
install -m 600 /dev/null ~/htdocs/screena.media/shared/.env.production
nano ~/htdocs/screena.media/shared/.env.production
# o release "current" recebe um symlink para o .env compartilhado:
ln -sfn ../shared/.env.production current/apps/web/.env.production
```

> Segredos vivem em `shared/` (fora dos releases) para sobreviver a deploys e
> nunca serem versionados.

### Passo 9 — Rodar as migrations

> **Fase 0:** ainda nao ha schema real nem migrations. Este passo fica
> documentado para as fases seguintes.

```bash
pnpm install --frozen-lockfile
pnpm --filter @screena/db migrate:deploy   # ilustrativo (Prisma/Drizzle)
```

Migrations sempre rodam **antes** de apontar o symlink `current` para o novo
release, para evitar app novo contra schema velho.

### Passo 10 — Buildar o Next.js

```bash
pnpm install --frozen-lockfile
pnpm --filter @screena/web build           # gera .next em modo standalone
```

Garanta `output: 'standalone'` no `next.config` para um bundle de runtime
enxuto.

### Passo 11 — Subir o app (PM2 ou systemd)

**Opcao A — `systemd` (recomendado, ver unit na secao 5):**

```bash
sudo systemctl enable --now screena-web.service
sudo systemctl status screena-web.service
```

**Opcao B — PM2:**

```bash
pm2 start "node apps/web/.next/standalone/server.js" --name screena-web \
  --cwd ~/htdocs/screena.media/current
pm2 save
pm2 startup     # gera o hook de boot
```

Escolha **uma** estrategia e padronize. Este guia prioriza `systemd`.

### Passo 12 — Criar os systemd timers dos workers

Instale os `*.service` e `*.timer` dos workers (secao 5) e habilite o
agendador.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now screena-scheduler.timer
sudo systemctl list-timers 'screena-*'
```

### Passo 13 — Ativar o SSL (CloudPanel)

No CloudPanel: **Sites -> screena.media -> SSL/TLS -> New Let's Encrypt
Certificate**, incluindo `screena.media` e `www.screena.media`. Ative o
redirect HTTP -> HTTPS.

### Passo 14 — Configurar backup

- **Banco:** dump diario do PostgreSQL para diretorio versionado/retido.
- **Segredos e uploads:** backup de `shared/` (inclui `.env.production`).
- Replique os backups para fora do VPS (object storage).

```bash
# ilustrativo: dump diario via cron/systemd timer
pg_dump "$SCREENA_DATABASE_URL" | gzip > /var/backups/screena/db-$(date +%F).sql.gz
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

- **App:** `journalctl -u screena-web.service` (ou logs do PM2).
- **Workers:** `journalctl -u screena-worker-*.service`.
- **Nginx:** logs do site no CloudPanel.
- **Sync externo:** alem do log do sistema, todo sync grava em
  `api_sync_logs` (regra de auditoria do projeto).

```bash
journalctl -u screena-web.service -f
journalctl -u 'screena-worker-*' --since "1 hour ago"
```

### Passo 17 — Criar staging em subdominio

Replique o ambiente em `staging.screena.media` com **banco e segredos
separados**.

- Site Node.js separado no CloudPanel, porta interna distinta (ex.: `3001`).
- `SCREENA_PUBLIC_SITE_URL=https://staging.screena.media`.
- Banco `screena_staging` e `.env.production` proprios.
- **noindex** no staging (coerente com a regra de paginas em draft).

### Passo 18 — Rollback por release folder

Como cada deploy vive em `releases/<timestamp>` e `current` e um symlink,
o rollback e instantaneo: re-apontar `current` para o release anterior e
reiniciar o servico.

```bash
cd ~/htdocs/screena.media
ln -sfn releases/<timestamp_anterior> current
sudo systemctl restart screena-web.service
```

> Se o release com problema rodou migrations destrutivas, o rollback de
> codigo **nao** desfaz o schema. Prefira migrations aditivas/compativeis e
> tenha o dump do Passo 14 a mao.

---

## 4. Lista de processos / servicos

| Unit | Tipo | Funcao | Disparo |
| --- | --- | --- | --- |
| `screena-web.service` | `simple` (long-running) | App Next.js (`@screena/web`) na porta 3000 | Boot / `systemctl` |
| `screena-worker-tmdb.service` | `oneshot` | Sync de metadados TMDB (filmes, series, pessoas) | `screena-scheduler.timer` |
| `screena-worker-ratings.service` | `oneshot` | Coleta de ratings externos (com atribuicao e licenca) | `screena-scheduler.timer` |
| `screena-worker-streaming.service` | `oneshot` | Disponibilidade "onde assistir" por pais | `screena-scheduler.timer` |
| `screena-worker-entity-writer.service` | `oneshot` | Entity Writer (Gemini offline) gerando `content_blocks` | `screena-scheduler.timer` |
| `screena-worker-rssprime.service` | `oneshot` | Ingestao de RSS/noticias (RSS Prime) | `screena-scheduler.timer` |
| `screena-scheduler.timer` | `timer` | Orquestra/encadeia os workers acima em janelas agendadas | Calendario do `systemd` |

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

### 5.1 `screena-web.service` (app Next.js)

```ini
# /etc/systemd/system/screena-web.service
[Unit]
Description=Screena Web (Next.js) - screena.media
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=screena
WorkingDirectory=/home/screena/htdocs/screena.media/current
EnvironmentFile=/home/screena/htdocs/screena.media/shared/.env.production
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

### 5.2 `screena-worker-tmdb.service` (worker oneshot)

```ini
# /etc/systemd/system/screena-worker-tmdb.service
[Unit]
Description=Screena Worker - TMDB sync (offline)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=oneshot
User=screena
WorkingDirectory=/home/screena/htdocs/screena.media/current/workers
EnvironmentFile=/home/screena/htdocs/screena.media/shared/.env.production
ExecStart=/home/screena/htdocs/screena.media/shared/venv/bin/python -m screena_workers.tmdb
NoNewPrivileges=true
PrivateTmp=true
```

> Os demais workers (`ratings`, `streaming`, `entity-writer`, `rssprime`)
> seguem o mesmo molde, mudando `Description` e o modulo Python em
> `ExecStart` (ex.: `-m screena_workers.ratings`).

### 5.3 `screena-scheduler.timer` (+ service de orquestracao)

```ini
# /etc/systemd/system/screena-scheduler.service
[Unit]
Description=Screena Scheduler - encadeia os workers offline

[Service]
Type=oneshot
User=screena
# dispara os workers na ordem correta (TMDB -> ratings -> streaming ...)
ExecStart=/usr/bin/systemctl start --wait screena-worker-tmdb.service
ExecStart=/usr/bin/systemctl start --wait screena-worker-ratings.service
ExecStart=/usr/bin/systemctl start --wait screena-worker-streaming.service
ExecStart=/usr/bin/systemctl start --wait screena-worker-rssprime.service
ExecStart=/usr/bin/systemctl start --wait screena-worker-entity-writer.service
```

```ini
# /etc/systemd/system/screena-scheduler.timer
[Unit]
Description=Screena Scheduler timer (janelas de sync offline)

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
# vhost ilustrativo (gerado pelo CloudPanel) - screena.media
server {
    listen 443 ssl http2;
    server_name screena.media www.screena.media;

    # SSL gerenciado pelo CloudPanel (Let's Encrypt)
    ssl_certificate     /etc/nginx/ssl-certificates/screena.media.crt;
    ssl_certificate_key /etc/nginx/ssl-certificates/screena.media.key;

    # Redireciona www -> apex
    if ($host = www.screena.media) {
        return 301 https://screena.media$request_uri;
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
    server_name screena.media www.screena.media;
    return 301 https://screena.media$request_uri;
}
```

---

## 7. Variaveis de ambiente

> **AVISO DE SEGURANCA (inegociavel).** Todas as chaves abaixo vivem
> **somente** em variaveis de ambiente do servidor (`.env.production` em
> `shared/`, `0600`, fora do controle de versao). **Nunca** sao expostas ao
> frontend, **nunca** vao para o bundle do cliente, **nunca** sao commitadas
> e **nunca** aparecem em paginas indexaveis. Apenas
> `SCREENA_PUBLIC_SITE_URL` e publica (URL canonica do site); todas as demais
> sao **segredos de servidor** lidos apenas pelo app server e pelos workers.

| Variavel | Usada por | Publica? | Descricao |
| --- | --- | --- | --- |
| `SCREENA_DATABASE_URL` | web (leitura) + workers (escrita) | Nao | Connection string do PostgreSQL (`postgres://user:pass@host:5432/screena_prod`). Em banco gerenciado, inclua `?sslmode=require`. |
| `SCREENA_PUBLIC_SITE_URL` | web | **Sim** | URL canonica publica (`https://screena.media`). Usada em canonicals, sitemap, OG. |
| `SCREENA_TMDB_API_KEY` | worker `tmdb` | Nao | Chave do TMDB. So o worker offline a usa; nunca o render. |
| `SCREENA_GEMINI_API_KEY` | worker `entity-writer` | Nao | Chave do Gemini. So o Entity Writer offline a usa (Invariante 4). |
| `SCREENA_RATINGS_PROVIDER_KEY` | worker `ratings` | Nao | Chave do provedor tecnico de ratings (`provider_api`), distinto da fonte editorial (Invariante 2). |
| `SCREENA_STREAMING_PROVIDER_KEY` | worker `streaming` | Nao | Chave do provedor de disponibilidade "onde assistir". |
| `SCREENA_REDIS_URL` | web (cache) + workers (fila) | Nao | URL do Redis (`redis://:senha@127.0.0.1:6379/0`). Opcional; se ausente, cai para cache local. |

### 7.1 Exemplo de `.env.production` (valores fictícios)

```dotenv
# /home/screena/htdocs/screena.media/shared/.env.production  (chmod 600)

# --- Banco ---
SCREENA_DATABASE_URL=postgres://screena_app:TROQUE_ESTA_SENHA@127.0.0.1:5432/screena_prod

# --- Publico (unica variavel exposta ao cliente) ---
SCREENA_PUBLIC_SITE_URL=https://screena.media

# --- Segredos de servidor (NUNCA no frontend) ---
SCREENA_TMDB_API_KEY=coloque_a_chave_aqui
SCREENA_GEMINI_API_KEY=coloque_a_chave_aqui
SCREENA_RATINGS_PROVIDER_KEY=coloque_a_chave_aqui
SCREENA_STREAMING_PROVIDER_KEY=coloque_a_chave_aqui

# --- Cache/fila (opcional) ---
SCREENA_REDIS_URL=redis://:TROQUE_ESTA_SENHA@127.0.0.1:6379/0
```

> Apenas variaveis explicitamente publicas (ex.: `SCREENA_PUBLIC_SITE_URL`)
> podem ser expostas ao cliente via prefixo de build do Next. Toda chave de
> API (`*_API_KEY`, `*_PROVIDER_KEY`) e segredo de servidor e jamais recebe
> esse prefixo.

---

## 8. Checklist final de deploy

- [ ] VPS provisionado, SSH por chave, usuario `sudo` dedicado.
- [ ] CloudPanel instalado e admin criado.
- [ ] Site Node.js criado (Node 22, porta 3000, usuario `screena`).
- [ ] DNS de `screena.media` e `www` apontando para o VPS.
- [ ] Banco `screena_prod` e usuario `screena_app` criados.
- [ ] Repo clonado em `releases/<timestamp>`, symlink `current` ativo.
- [ ] `.env.production` em `shared/` (`0600`), fora do git.
- [ ] Migrations aplicadas (fases seguintes).
- [ ] Build do Next.js (`standalone`) concluido.
- [ ] `screena-web.service` ativo, escutando em `127.0.0.1:3000`.
- [ ] Timers dos workers habilitados; `entity-writer` so offline.
- [ ] SSL Let's Encrypt emitido; redirect HTTP -> HTTPS e `www` -> apex.
- [ ] Backups (banco + `shared/`) agendados e replicados para fora do VPS.
- [ ] Firewall: so 22/80/443/8443; 3000/5432/6379 fechados na internet.
- [ ] Logs verificados (`journalctl` + `api_sync_logs`).
- [ ] Staging em `staging.screena.media` com banco/segredos proprios e
      `noindex`.
- [ ] Procedimento de rollback por release folder testado.
