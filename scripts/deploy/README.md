# scripts/deploy — Deploy do Screen

Esta pasta documenta automacoes de deploy futuras. O procedimento operacional
atual fica em `docs/EASYPANEL_DEPLOY.md`.

Ponto inegociavel para qualquer release: `prisma migrate deploy` deve rodar
contra a `DATABASE_URL` de producao antes do app novo receber trafego. Nao rode
migration a partir do render nem como tarefa implicita depois do start.
