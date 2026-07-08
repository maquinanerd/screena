# scripts/backup — Backups automaticos do PostgreSQL

Scripts operacionais para backup logico e teste de restore do PostgreSQL do
Screen. Eles rodam fora do caminho de render, com credenciais vindas de env vars.

## Scripts

| Script | Responsabilidade |
| --- | --- |
| `backup.sh` | Roda `pg_dump -Fc`, grava dump com timestamp, gera checksum SHA-256 e opcionalmente copia off-site via `rclone`. |
| `restore-test.sh` | Restaura o ultimo dump em base efemera, valida `SELECT count(*) FROM content_blocks`, e derruba a base. |

Ferramentas esperadas no servidor: `pg_dump`, `pg_restore`, `psql` e
`sha256sum` ou `shasum`. Para copia off-site, instale/configure `rclone`.

## Variaveis

| Variavel | Obrigatoria? | Descricao |
| --- | --- | --- |
| `DATABASE_URL` | Sim, para backup | Connection string da base origem. Nunca versionar. |
| `BACKUP_DIR` | Nao | Diretorio dos dumps (default: `./backups/postgres`). Em producao, use volume persistente fora do repo. |
| `BACKUP_PREFIX` | Nao | Prefixo do arquivo (default: `screen-postgres`). |
| `BACKUP_OFFSITE_RCLONE_REMOTE` | Nao | Destino `rclone` para copia off-site, ex.: `s3:screen-backups/postgres`. |
| `RESTORE_TEST_ADMIN_URL` | Sim, para restore-test | Connection string administrativa para criar/dropar a base efemera. |
| `RESTORE_TEST_DB_NAME` | Nao | Nome da base efemera. Default inclui timestamp. |
| `RESTORE_TEST_DATABASE_URL` | Nao | URL alvo explicita; por default deriva de `RESTORE_TEST_ADMIN_URL` + `RESTORE_TEST_DB_NAME`. |

## Backup diario

```bash
export DATABASE_URL="postgresql://..."
export BACKUP_DIR="/home/screen/backups/postgres"
export BACKUP_OFFSITE_RCLONE_REMOTE="s3:screen-backups/postgres" # opcional
scripts/backup/backup.sh
```

O script gera:

```text
/home/screen/backups/postgres/
  screen-postgres-YYYYMMDDTHHMMSSZ.dump
  screen-postgres-YYYYMMDDTHHMMSSZ.dump.sha256
```

## Cron diario

Exemplo em `/etc/cron.d/screen-postgres-backup`:

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
DATABASE_URL=postgresql://user:password@localhost:5432/screen
BACKUP_DIR=/home/screen/backups/postgres
BACKUP_OFFSITE_RCLONE_REMOTE=s3:screen-backups/postgres

30 3 * * * screen cd /home/screen/app/current && scripts/backup/backup.sh >> /home/screen/backups/postgres/backup.log 2>&1
```

Em vez de colocar `DATABASE_URL` direto no cron, prefira carregar um env file com
permissao `0600` quando o ambiente suportar.

## Teste de restore

```bash
export BACKUP_DIR="/home/screen/backups/postgres"
export RESTORE_TEST_ADMIN_URL="postgresql://user:password@localhost:5432/postgres"
scripts/backup/restore-test.sh
```

O teste:

1. Localiza o ultimo `*.dump`.
2. Valida o `.sha256`.
3. Cria uma base efemera.
4. Restaura com `pg_restore`.
5. Roda `SELECT count(*) FROM content_blocks;`.
6. Derruba a base efemera no `trap` de saida.

## Restore real

1. Escolha o dump e valide o checksum:

   ```bash
   cd /home/screen/backups/postgres
   sha256sum -c screen-postgres-YYYYMMDDTHHMMSSZ.dump.sha256
   ```

2. Restaure primeiro em base isolada, nunca direto em producao:

   ```bash
   createdb screen_restore_check
   pg_restore --no-owner --no-acl --exit-on-error \
     --dbname="postgresql://user:password@localhost:5432/screen_restore_check" \
     screen-postgres-YYYYMMDDTHHMMSSZ.dump
   psql "postgresql://user:password@localhost:5432/screen_restore_check" \
     --command='SELECT count(*) FROM content_blocks;'
   ```

3. Somente depois de validar contagens e integridade, planeje promocao/restore de
   producao com revisao humana.

Backups contem dados sensiveis/licenciados: nunca commitar, nunca expor em
frontend e sempre replicar para armazenamento fora do VPS.
