# Runbook — Observabilidade e imagem (Cinerie)

> Health check, versão rastreável, endurecimento da imagem e o **catálogo de
> alertas** operacionais. Tudo citado existe no repositório.

---

## 1. Health check

`GET /api/health` (`apps/web/app/api/health/route.ts`), `force-dynamic`, runtime
Node. Lê **apenas PostgreSQL** (invariantes 3/4 preservadas). Responde:

```json
{ "status": "ok", "database": "ok", "checkDurationMs": 3,
  "version": { "commit": "abc1234", "version": "v1.2.3", "builtAt": "2026-..." },
  "timestamp": "2026-..." }
```

- **200** quando o `SELECT 1` responde; **503** (`status:"degraded"`) quando
  não — para o orquestrador despromover um container sem banco.
- Sem cache (`cache-control: no-store`).
- Verificado por smoke: 200 + `database:"ok"` + versão rastreável.

### 1.1 HEALTHCHECK do container

O `Dockerfile` declara:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
```

Usa `node` (a base slim não tem `curl`/`wget`). `start-period=60s` cobre o
`prisma migrate deploy` do boot.

---

## 2. Versão rastreável

Injetada no build via `--build-arg` e lida em runtime por `getAppVersion()`
(`apps/web/src/lib/app-version.ts`):

```bash
docker build \
  --build-arg CINERIE_BUILD_SHA=$(git rev-parse HEAD) \
  --build-arg CINERIE_BUILD_VERSION=v1.2.3 \
  --build-arg CINERIE_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  -t cinerie-web:v1.2.3 .
```

Sem os args, resolvem `"unknown"` — nunca inventam um SHA. Não são envs públicas
de site/indexação; são metadados seguros de baking.

---

## 3. Endurecimento da imagem

| Item | Estado | Onde |
| --- | --- | --- |
| Base pinada por **digest** (não tag flutuante) | `ARG NODE_IMAGE=node:22-bookworm-slim@sha256:6c74791e…f6b3` | `Dockerfile` |
| Base **sobrescrevível** no deploy | `--build-arg NODE_IMAGE=…@sha256:<novo>` | idem |
| Container **não-root** (`USER node`, uid 1000) | `chown -R node:node /app` + `USER node` | idem |
| Migrate no boot **fail-loud** | `migrate deploy || exit 1` | idem (preservado) |
| Rota técnica `/dev/*` **não pública em produção** | `notFound()` quando `NODE_ENV=production` | `apps/web/app/dev/movie-page-preview/page.tsx` |

### 3.1 Atualizar o digest da base

```bash
TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull" | jq -r .token)
curl -sI -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.oci.image.index.v1+json" \
  https://registry-1.docker.io/v2/library/node/manifests/22-bookworm-slim | grep -i docker-content-digest
```

Aplique no `Dockerfile` (default do `ARG NODE_IMAGE`) ou passe via `--build-arg`.

> ⚠️ As mudanças de runtime do container (não-root, HEALTHCHECK, pin) **não são
> build-testadas localmente** quando o Docker está indisponível na estação de
> dev. Devem passar pelo build do pipeline de deploy antes do merge.

---

## 4. Catálogo de alertas

Fontes reconhecidas por `scripts/backup/lib/alert.mjs` (`ALERT_SOURCES`).
Severidade: `backup`/`migration`/`availability` = **critical**; demais = **warning**.

| Fonte | Gatilho | Como é disparado |
| --- | --- | --- |
| `backup` | `backup.sh` sai != 0 | `backup-with-alert.sh` → webhook (`BACKUP_ALERT_WEBHOOK_URL`). **Implementado + testado.** |
| `restore-test` | `restore-test.sh` semanal falha | systemd `OnFailure=` → serviço de alerta (§4.1). |
| `migration` | `migrate deploy` falha no boot | container sai != 0 (fail-loud, `Dockerfile`); o orquestrador não promove e alerta pela indisponibilidade. |
| `availability` | `/api/health` != 200 por N ciclos | HEALTHCHECK do container / probe externo do monitor. |
| `http-5xx` | taxa de 5xx acima do limiar | monitor de logs/proxy (fora do repo) → alerta. |
| `sync` | worker de ingestão/ratings/streaming falha | `api_sync_logs` com `status=failure`; alerta pelo scheduler do worker. |
| `queue` | fila `catalog_jobs` com backlog/dead-letter | consulta periódica (ver `catalog-dead-letter.md`). |
| `disk` | `BACKUP_DIR`/volume acima do limiar | check de disco no host → alerta. |

### 4.1 Serviço de alerta genérico (systemd `OnFailure`)

`/etc/systemd/system/cinerie-restore-test-alert.service`:

```ini
[Unit]
Description=Cinerie — alerta de falha de restore-test
[Service]
Type=oneshot
Environment=BACKUP_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/XXX
ExecStart=/usr/bin/node --input-type=module -e "const m=await import('file:///home/screen/app/current/scripts/backup/lib/alert.mjs'); const a=m.buildAlert({source:'restore-test',status:'failure',timestamp:new Date().toISOString()}); console.error(m.formatAlertText(a)); await m.dispatchAlert(a, process.env.BACKUP_ALERT_WEBHOOK_URL);"
```

> Os alertas `http-5xx`, `sync`, `queue` e `disk` têm o **mecanismo** (a fonte no
> catálogo + o construtor de payload redigido); o **fio** até o monitor
> (Prometheus/Alertmanager, systemd timers, proxy) é configuração de
> infraestrutura do host, fora do código do repositório. Este runbook define o
> contrato; ligar cada fonte é passo de provisionamento.
