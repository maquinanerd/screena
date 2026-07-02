# scripts/backup — Backups automaticos do PostgreSQL

> Esta pasta documenta os scripts de **backup** que serao implementados em fases
> posteriores. Hoje ainda existe **apenas** este README descrevendo o contrato e
> a politica. Nenhum backup real roda agora.

## Objetivo

Garantir que a base canonica do Screen (PostgreSQL) — entidades, ratings com
atribuicao, `content_blocks` versionados, decisoes de indexabilidade, logs de
sync — seja **recuperavel** a qualquer momento, com perda minima de dados.

## Principios

1. **Backups automaticos e agendados** via **systemd timers** (mesmo padrao dos
   workers), nao por cron manual ad-hoc.
2. **Segredos so em env vars**: a conexao (`DATABASE_URL` / variaveis `PG*`)
   nunca aparece em codigo versionado nem em logs.
3. **Backup nao toca o render**: roda fora do caminho de request; nunca degrada
   paginas publicas.
4. **Restore testavel**: um backup so vale se a restauracao foi verificada. O
   procedimento de restore e parte do contrato, nao um pensamento posterior.
5. **Retencao explicita**: politica de retencao definida e aplicada
   automaticamente (limpeza de backups vencidos).

## Estrategia (alvo)

- **Dump logico** com `pg_dump` (formato custom/`-Fc`) para snapshots completos
  e portateis, com `gzip`.
- **Cadencia** sugerida:
  - **Diario**: dump completo, retencao 7-14 dias.
  - **Semanal**: dump completo, retencao 4-8 semanas.
  - **Mensal**: dump completo, retencao 6-12 meses.
- **Off-site**: copiar os artefatos para armazenamento externo (object storage)
  alem do disco local do VPS — backup so no mesmo host nao protege contra perda
  do host.
- **Integridade**: gerar checksum (ex.: SHA-256) por artefato e registrar
  tamanho/timestamp.
- **WAL/PITR** (futuro, opcional): para recuperacao a um ponto no tempo, avaliar
  archiving de WAL alem dos dumps logicos.

## Layout de artefatos (alvo)

```
/home/screena/backups/
  daily/    screena-YYYYMMDD-HHMMSSZ.dump.gz   (+ .sha256)
  weekly/
  monthly/
  logs/     backup-YYYYMMDD.log
```

## Scripts previstos (a implementar)

| Script | Responsabilidade |
| --- | --- |
| `pg-backup.sh` | `pg_dump -Fc` + gzip + checksum; grava em `daily/weekly/monthly`. |
| `pg-restore.sh` | Restaura um artefato escolhido em base alvo (com confirmacao). |
| `prune.sh` | Remove backups vencidos conforme a politica de retencao. |
| `upload-offsite.sh` | Replica artefatos para armazenamento externo. |
| `verify.sh` | Valida checksum e (opcional) testa restore em base efemera. |

## Agendamento (systemd timer — alvo)

```
# /etc/systemd/system/screena-backup.timer  (exemplo conceitual)
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

```
# /etc/systemd/system/screena-backup.service  (exemplo conceitual)
[Service]
Type=oneshot
EnvironmentFile=/home/screena/app/shared/.env   # segredos fora do git
ExecStart=/home/screena/app/current/scripts/backup/pg-backup.sh
```

## Restore (procedimento minimo, alvo)

1. Selecionar o artefato (`daily/weekly/monthly`) e validar checksum (`verify.sh`).
2. Restaurar em uma base **alvo isolada** primeiro (nunca direto em producao sem
   validacao).
3. Conferir contagens-chave (entidades, `content_blocks` `published`, ratings com
   licenca/atribuicao).
4. So entao promover, com revisao humana.

## Variaveis de ambiente esperadas (no servidor, fora do git)

- `DATABASE_URL` ou `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD`.
- `BACKUP_DIR` — diretorio base dos artefatos.
- Credenciais de armazenamento off-site (se aplicavel) — **so em env vars**.

> Backups contem dados sensiveis e licenciados. Trate os artefatos com o mesmo
> cuidado da base: acesso restrito, nunca no git, nunca expostos no frontend.
