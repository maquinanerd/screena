# dump-manifest.awk — extrai o MANIFESTO ESPERADO de um dump do PostgreSQL.
#
# Entrada: a saida textual de `pg_restore --file=- <dump>` (o SQL que o restore
# executaria, com os blocos COPY inline). Saida: quatro arquivos, um item por
# linha, que descrevem o que o dump DECLARA conter:
#
#   tables_out       -> schema.tabela                    (CREATE TABLE)
#   rows_out         -> schema.tabela<TAB>linhas         (bloco COPY / INSERT)
#   indexes_out      -> schema.indice                    (CREATE [UNIQUE] INDEX)
#   constraints_out  -> schema.constraint                (ADD CONSTRAINT p/f/u/x)
#
# Escopo deliberado das constraints: so PRIMARY KEY, FOREIGN KEY, UNIQUE e
# EXCLUDE. Sao exatamente as que o pg_dump emite como `ALTER TABLE ... ADD
# CONSTRAINT` separado; CHECK e NOT NULL saem inline no CREATE TABLE e por isso
# nao entram nem aqui nem no lado consultado do banco restaurado — comparar
# conjuntos assimetricos produziria divergencia falsa.
#
# Escopo dos indices: so os criados por `CREATE INDEX`. Indice que sustenta uma
# constraint (ex.: `*_pkey`) nao aparece como CREATE INDEX no dump; do lado do
# banco ele e filtrado por `pg_constraint.conindid`.
#
# Limite conhecido: identificador com espaco ou parentese dentro de aspas (ex.:
# `public."minha tabela"`) nao e suportado. O schema da Cinerie e gerado pelo
# Prisma e nunca produz esses nomes.

function unquote(s) {
  if (s ~ /^".*"$/) {
    s = substr(s, 2, length(s) - 2)
    gsub(/""/, "\"", s)
  }
  return s
}

# Quebra `schema.rel` no ponto que estiver FORA de aspas.
function qsplit(q, parts,   i, c, cur, inq, n) {
  n = 0; cur = ""; inq = 0
  for (i = 1; i <= length(q); i++) {
    c = substr(q, i, 1)
    if (c == "\"") { inq = !inq; cur = cur c; continue }
    if (c == "." && !inq) { parts[++n] = cur; cur = ""; continue }
    cur = cur c
  }
  parts[++n] = cur
  return n
}

function norm(q,   parts, n, i, out) {
  n = qsplit(q, parts)
  out = ""
  for (i = 1; i <= n; i++) out = out (i > 1 ? "." : "") unquote(parts[i])
  if (n == 1) out = "public." out
  return out
}

function schema_of(q,   parts, n) {
  n = qsplit(q, parts)
  if (n >= 2) return unquote(parts[1])
  return "public"
}

function emit_table(   line, parts) {
  line = $0
  sub(/^CREATE[ \t]+(UNLOGGED[ \t]+)?TABLE[ \t]+/, "", line)
  sub(/^IF[ \t]+NOT[ \t]+EXISTS[ \t]+/, "", line)
  split(line, parts, /[ \t(]/)
  printf "%s\n", norm(parts[1]) >> tables_out
}

# CREATE INDEX i ON s.t ...        -> $2=INDEX  $3=i  $4=ON  $5=s.t
# CREATE UNIQUE INDEX i ON s.t ... -> $3=INDEX  $4=i  $5=ON  $6=s.t
function emit_index(   i, j) {
  i = ($2 == "UNIQUE") ? 3 : 2
  j = i + 3
  if ($j == "ONLY") j++
  printf "%s.%s\n", schema_of($j), unquote($(i + 1)) >> indexes_out
}

function emit_constraint(   p, cname, ctype) {
  for (p = 1; p < NF; p++) if ($p == "ADD" && $(p + 1) == "CONSTRAINT") break
  if (p >= NF) return
  cname = $(p + 2); ctype = $(p + 3)
  if (ctype == "PRIMARY" || ctype == "FOREIGN" || ctype == "UNIQUE" || ctype == "EXCLUDE")
    printf "%s.%s\n", schema_of(alter_target), unquote(cname) >> constraints_out
}

BEGIN { in_copy = 0 }

# Dentro de um bloco COPY TUDO e dado: nenhuma linha e interpretada como DDL.
# No formato TEXT do COPY toda quebra de linha real vira `\n` escapado, entao
# cada registro ocupa exatamente uma linha fisica e a linha `\.` so pode ser o
# terminador (uma barra literal seria escapada como `\\`).
in_copy == 1 {
  if ($0 == "\\.") {
    printf "%s\t%d\n", copy_table, copy_rows >> rows_out
    in_copy = 0
  } else {
    copy_rows++
  }
  next
}

/^COPY[ \t]/ {
  line = $0
  sub(/^COPY[ \t]+/, "", line)
  sub(/[ \t]+FROM[ \t]+stdin;[ \t]*$/, "", line)
  sub(/[ \t]*\([^()]*\)[ \t]*$/, "", line)
  copy_table = norm(line)
  copy_rows = 0
  in_copy = 1
  next
}

# Dump gerado com `--inserts` (uma linha por registro). O backup.sh da Cinerie
# usa o formato custom (COPY); isto existe so para nao dar vermelho falso.
/^INSERT INTO [^ ]+ VALUES / { insert_rows[norm($3)]++; next }

/^CREATE TABLE /          { emit_table(); next }
/^CREATE UNLOGGED TABLE / { emit_table(); next }
/^CREATE INDEX /          { emit_index(); next }
/^CREATE UNIQUE INDEX /   { emit_index(); next }

# `ADD CONSTRAINT` costuma vir na linha SEGUINTE ao `ALTER TABLE ONLY s.t`; por
# isso esta regra guarda o alvo e NAO consome a linha.
$1 == "ALTER" && $2 == "TABLE" {
  k = 3
  if ($k == "ONLY") k++
  alter_target = $k
}

/(^|[ \t])ADD CONSTRAINT[ \t]/ { emit_constraint() }

END {
  for (t in insert_rows) printf "%s\t%d\n", t, insert_rows[t] >> rows_out
}
