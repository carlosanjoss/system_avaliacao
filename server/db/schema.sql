PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  versao INTEGER PRIMARY KEY,
  aplicado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schema_meta (versao) VALUES (1);

CREATE TABLE IF NOT EXISTS avaliadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL CHECK (length(trim(nome)) >= 2),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (instr(email, '@') > 1),
  username TEXT COLLATE NOCASE,
  senha_hash TEXT,
  senha_salt TEXT,
  papel TEXT NOT NULL DEFAULT 'avaliador' CHECK (papel IN ('admin', 'avaliador')),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  avaliador_id INTEGER NOT NULL REFERENCES avaliadores(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL,
  ultimo_acesso_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessoes_token ON sessoes(token_hash, expira_em);

CREATE TABLE IF NOT EXISTS tentativas_login (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  sucesso INTEGER NOT NULL CHECK (sucesso IN (0, 1)),
  tentado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tentativas_login ON tentativas_login(username, tentado_em DESC);

CREATE TABLE IF NOT EXISTS categorias_odio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL COLLATE NOCASE UNIQUE,
  ordem INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_arquivo TEXT NOT NULL,
  data_upload TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  coluna_conteudo TEXT NOT NULL,
  coluna_resultado TEXT NOT NULL,
  tipo_avaliacao TEXT NOT NULL CHECK (tipo_avaliacao IN ('individual', 'dupla')),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_andamento', 'concluido'))
);

CREATE TABLE IF NOT EXISTS lote_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  linha_index INTEGER NOT NULL CHECK (linha_index >= 1),
  conteudo TEXT NOT NULL CHECK (length(trim(conteudo)) > 0),
  dados_originais TEXT NOT NULL CHECK (json_valid(dados_originais)),
  UNIQUE (lote_id, linha_index)
);

CREATE INDEX IF NOT EXISTS idx_lote_itens_lote ON lote_itens(lote_id, linha_index);

CREATE TABLE IF NOT EXISTS lote_avaliadores (
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  avaliador_id INTEGER NOT NULL REFERENCES avaliadores(id) ON DELETE RESTRICT,
  ordem INTEGER NOT NULL CHECK (ordem IN (1, 2)),
  PRIMARY KEY (lote_id, avaliador_id),
  UNIQUE (lote_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_lote_avaliadores_avaliador ON lote_avaliadores(avaliador_id, lote_id);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES lote_itens(id) ON DELETE CASCADE,
  avaliador_id INTEGER NOT NULL REFERENCES avaliadores(id) ON DELETE RESTRICT,
  classificacao TEXT NOT NULL CHECK (classificacao IN ('hate', 'nao_hate')),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_id, avaliador_id)
);

CREATE INDEX IF NOT EXISTS idx_avaliacoes_item ON avaliacoes(item_id, avaliador_id);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_avaliador ON avaliacoes(avaliador_id, item_id);

CREATE TABLE IF NOT EXISTS avaliacao_categorias (
  avaliacao_id INTEGER NOT NULL REFERENCES avaliacoes(id) ON DELETE CASCADE,
  categoria_id INTEGER NOT NULL REFERENCES categorias_odio(id) ON DELETE RESTRICT,
  PRIMARY KEY (avaliacao_id, categoria_id)
);

CREATE TABLE IF NOT EXISTS reconciliacoes (
  item_id INTEGER PRIMARY KEY REFERENCES lote_itens(id) ON DELETE CASCADE,
  decisao_final TEXT NOT NULL CHECK (decisao_final IN ('hate', 'nao_hate')),
  categorias_finais TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(categorias_finais)),
  decidido_por INTEGER REFERENCES avaliadores(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO categorias_odio (nome, ordem) VALUES
  ('Etarismo', 1),
  ('Classismo', 2),
  ('Gordofobia', 3),
  ('Capacitismo', 4),
  ('LGBTfobia', 5),
  ('Misoginia', 6),
  ('Ódio Político', 7),
  ('Racismo', 8),
  ('Intolerância Religiosa', 9),
  ('Xenofobia', 10);

INSERT OR IGNORE INTO schema_meta (versao) VALUES (2);

PRAGMA user_version = 2;
