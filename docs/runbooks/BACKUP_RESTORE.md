# Runbook — Backup, restore e rollback de banco (Cinerie)

> Operacional. Cobre backup lógico do PostgreSQL, teste de restore com
> **fidelidade de dados**, agendamento, alertas e o rollback real de schema
> (que, sem down-migrations, é o restore de dump). Toda ferramenta citada existe
> no repositório e é exercitada na CI.

---

## 1. Por que isto importa

- As migrations do Prisma são **forward-only**: não há down-migration. Reverter
  a imagem da aplicação **não** reverte o banco. O único rollback de schema é
  **restaurar um dump**.
- Regra do projeto: **sem backup validado, sem sync/promote em produção**
  (`scripts/backup/README.md`).

---

## 2. Objetivos de recuperação (RPO / RTO / retenção)

| Parâmetro | Alvo | Base |
| --- | --- | --- |
| **RPO** (perda máxima aceitável) | **24 h** | backup diário automatizado (§4). Reduzir para 1 h exige WAL archiving/PITR — fora do escopo atual. |
| **RTO** (tempo de recuperação) | **≤ 1 h** | restore de dump custom-format + `migrate deploy` já aplicado na imagem. |
| **Retenção local** | **14 dumps** (≈2 semanas diárias) | poda em `BACKUP_DIR` (§4.2). |
| **Retenção off-site** | **conforme política do bucket** | cópia via `rclone` (`BACKUP_OFFSITE_RCLONE_REMOTE`). |
| **Verificação de restore** | **semanal** | `restore-test` agendado (§4). |

> Os dumps contêm dado **sensível/licenciado** — `BACKUP_DIR` deve ser volume
> persistente fora do repositório, permissão `700`, e o dump `600` (o
> `backup.sh` já aplica).

---

## 3. Ferramentas

| Script | Papel |
| --- | --- |
| `scripts/backup/backup.sh` | `pg_dump -Fc` + checksum SHA-256 (+ off-site opcional). |
| `scripts/backup/backup-with-alert.sh` | Envelope: roda `backup.sh` e, em falha, dispara alerta redigido (§5). |
| `scripts/backup/restore-test.sh` | Restaura o dump em base **efêmera isolada**, valida e a derruba. Nunca toca a origem; sem `--clean`/`--create`. |
| `scripts/backup/verify-backup-restore.sh` | Prova ponta-a-ponta com **fidelidade de dados** (origem == restaurado). Roda na CI. |
| `scripts/backup/lib/alert.mjs` | Construção pura do alerta (redige segredos). Testado em `tests/operations/backup-alert.test.ts`. |

---

## 4. Agendamento

### 4.1 Backup diário (cron)

`/etc/cron.d/cinerie-postgres-backup`:

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
DATABASE_URL=postgresql://user:senha@localhost:5432/screen
BACKUP_DIR=/home/screen/backups/postgres
BACKUP_OFFSITE_RCLONE_REMOTE=s3:screen-backups/postgres
BACKUP_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/XXX

# 03:30 UTC todo dia — usa o envelope com alerta.
30 3 * * * screen cd /home/screen/app/current && scripts/backup/backup-with-alert.sh >> /home/screen/backups/postgres/backup.log 2>&1
```

Prefira carregar `DATABASE_URL`/webhook de um env file `600` a colocá-los no cron.

### 4.2 Poda de retenção (mantém os 14 mais recentes)

```bash
ls -1t "$BACKUP_DIR"/*.dump | tail -n +15 | while read -r f; do rm -f "$f" "$f.sha256"; done
```

### 4.3 Restore-test semanal (systemd timer)

`/etc/systemd/system/cinerie-restore-test.service`:

```ini
[Unit]
Description=Cinerie — teste de restore do ultimo dump
OnFailure=cinerie-restore-test-alert.service

[Service]
Type=oneshot
User=screen
WorkingDirectory=/home/screen/app/current
Environment=BACKUP_DIR=/home/screen/backups/postgres
Environment=RESTORE_TEST_ADMIN_URL=postgresql://user:senha@localhost:5432/postgres
ExecStart=/home/screen/app/current/scripts/backup/restore-test.sh
```

`/etc/systemd/system/cinerie-restore-test.timer`:

```ini
[Unit]
Description=Cinerie — restore-test semanal
[Timer]
OnCalendar=Sun 04:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
```

`OnFailure=` encadeia um serviço de alerta (ver `OBSERVABILITY.md`).

---

## 5. Alerta de falha de backup

`backup-with-alert.sh` roda `backup.sh` e, em **qualquer** falha:

1. constrói um alerta `critical` com `scripts/backup/lib/alert.mjs`;
2. **redige segredos** (connection string, `*_KEY`, `password=`) — provado em
   `tests/operations/backup-alert.test.ts`;
3. dispara para `BACKUP_ALERT_WEBHOOK_URL` (Slack/webhook), se definido;
4. **preserva o código de saída** do backup — o alerta nunca mascara o erro;
5. se o canal estava configurado e a entrega **falhou**, imprime em stderr
   `backup-with-alert: ALERTA NAO ENTREGUE (<outcome>): <detail>` seguido de
   "o backup falhou e o canal de alerta tambem; ninguem foi notificado".

O item 5 existe porque, até 2026-08, a falha de entrega era engolida: o webhook
podia estar fora do ar e nada aparecia no log do cron. O `<outcome>` é
`http-error`, `timeout`, `network-error` ou `invalid-usage`, e o `<detail>` já
vem **redigido** (a URL do webhook é ela mesma um segredo). Contrato completo em
[`OBSERVABILITY.md`](./OBSERVABILITY.md) §4.2.

Verificado localmente: sem `DATABASE_URL`, o envelope emite
`[ALERTA][critical] backup exit=1 ...` e sai `1`.

---

## 6. Procedimento de RESTORE / ROLLBACK de schema

Use quando um deploy com migration precisa ser revertido, ou para recuperar de
perda/corrupção.

```bash
# 0. SEMPRE tenha um backup verificado ANTES de qualquer deploy com migration.
DATABASE_URL="postgresql://..." BACKUP_DIR=/home/screen/backups/postgres \
  scripts/backup/backup.sh
RESTORE_TEST_ADMIN_URL="postgresql://user:senha@host:5432/postgres" \
  scripts/backup/restore-test.sh        # precisa sair 0

# 1. Contenção imediata (sem tocar banco/imagem): kill switch de indexação.
#    (fail-closed; ver OBSERVABILITY.md)
export CINERIE_PUBLIC_INDEXING_ENABLED=false

# 2. Volte a imagem da aplicação para a tag/digest anterior.

# 3. Se a versão revertida for INCOMPATIVEL com o schema novo, restaure o dump
#    tirado no passo 0 numa base limpa e aponte a aplicação para ela:
createdb screen_rollback
pg_restore --no-owner --no-acl --exit-on-error --dbname="postgresql://.../screen_rollback" <dump-do-passo-0>
#    -> troque DATABASE_URL para screen_rollback (ou restaure sobre a base após
#       drenar conexões). NUNCA use --clean/--create apontando para produção viva.
```

> ⚠️ `restore-test.sh`/`verify-backup-restore.sh` **nunca** usam `--clean` nem
> `--create`: restauram só em base recém-criada e vazia. Um restore sobre a base
> de produção viva é operação manual, deliberada e drenada — nunca via estes
> scripts.

---

## 7. Prova automatizada na CI

O job **`backup-restore`** (`.github/workflows/ci.yml`) sobe um PostgreSQL 16
real, aplica migrations + seed, e roda `verify-backup-restore.sh`:

1. `backup.sh` gera dump + checksum;
2. `restore-test.sh` (script enviado) restaura e sai 0;
3. um restore próprio numa base efêmera compara contagens de aplicação
   (`_prisma_migrations`, `languages`, `countries`, `source_licenses`):
   **origem == restaurado**;
4. a base efêmera é derrubada.

Isto é execução **real** de backup+restore — não checagem de sintaxe. Na
máquina de dev Windows o `pg_dump`/`pg_restore`/`psql` não estão disponíveis
(e o Docker pode estar desligado); por isso a prova de execução vive na CI.
