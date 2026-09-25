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
  senha_temporaria INTEGER NOT NULL DEFAULT 0 CHECK (senha_temporaria IN (0, 1)),
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

CREATE TABLE IF NOT EXISTS modelos_avaliacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chave_base TEXT NOT NULL,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  sistema TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (chave_base, versao)
);

CREATE TABLE IF NOT EXISTS campos_modelo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modelo_id INTEGER NOT NULL REFERENCES modelos_avaliacao(id) ON DELETE CASCADE,
  chave TEXT NOT NULL,
  rotulo TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('unica', 'multipla', 'booleano', 'texto')),
  nome_coluna TEXT NOT NULL,
  obrigatorio INTEGER NOT NULL DEFAULT 1 CHECK (obrigatorio IN (0, 1)),
  ordem INTEGER NOT NULL CHECK (ordem >= 1),
  condicao_campo_id INTEGER REFERENCES campos_modelo(id) ON DELETE RESTRICT,
  condicao_operador TEXT CHECK (condicao_operador IS NULL OR condicao_operador IN ('igual', 'diferente', 'contem', 'qualquer', 'respondido', 'nao_respondido')),
  condicao_valores TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(condicao_valores)),
  UNIQUE (modelo_id, chave),
  UNIQUE (modelo_id, nome_coluna),
  UNIQUE (modelo_id, ordem)
);

CREATE TABLE IF NOT EXISTS opcoes_campo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campo_id INTEGER NOT NULL REFERENCES campos_modelo(id) ON DELETE CASCADE,
  valor TEXT NOT NULL,
  rotulo TEXT NOT NULL,
  cor TEXT NOT NULL DEFAULT 'teal',
  ordem INTEGER NOT NULL CHECK (ordem >= 1),
  encerra_fluxo INTEGER NOT NULL DEFAULT 0 CHECK (encerra_fluxo IN (0, 1)),
  UNIQUE (campo_id, valor),
  UNIQUE (campo_id, ordem)
);

CREATE TABLE IF NOT EXISTS lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_arquivo TEXT NOT NULL,
  data_upload TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  coluna_conteudo TEXT NOT NULL,
  colunas_contexto TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(colunas_contexto)),
  coluna_resultado TEXT NOT NULL,
  modelo_avaliacao_id INTEGER REFERENCES modelos_avaliacao(id),
  tipo_avaliacao TEXT NOT NULL CHECK (tipo_avaliacao IN ('individual', 'dupla')),
  distribuicao_conjunta INTEGER NOT NULL DEFAULT 0 CHECK (distribuicao_conjunta IN (0, 1)),
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
  ordem INTEGER NOT NULL CHECK (ordem >= 1),
  PRIMARY KEY (lote_id, avaliador_id),
  UNIQUE (lote_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_lote_avaliadores_avaliador ON lote_avaliadores(avaliador_id, lote_id);

CREATE TABLE IF NOT EXISTS lote_item_avaliadores (
  item_id INTEGER PRIMARY KEY REFERENCES lote_itens(id) ON DELETE CASCADE,
  avaliador_id INTEGER NOT NULL REFERENCES avaliadores(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_lote_item_avaliadores_avaliador ON lote_item_avaliadores(avaliador_id, item_id);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES lote_itens(id) ON DELETE CASCADE,
  avaliador_id INTEGER NOT NULL REFERENCES avaliadores(id) ON DELETE RESTRICT,
  classificacao TEXT,
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

CREATE TABLE IF NOT EXISTS avaliacao_respostas (
  avaliacao_id INTEGER NOT NULL REFERENCES avaliacoes(id) ON DELETE CASCADE,
  campo_id INTEGER NOT NULL REFERENCES campos_modelo(id) ON DELETE RESTRICT,
  valor_json TEXT NOT NULL CHECK (json_valid(valor_json)),
  PRIMARY KEY (avaliacao_id, campo_id)
);

CREATE TABLE IF NOT EXISTS reconciliacoes_personalizadas (
  item_id INTEGER PRIMARY KEY REFERENCES lote_itens(id) ON DELETE CASCADE,
  respostas_json TEXT NOT NULL CHECK (json_valid(respostas_json)),
  decidido_por INTEGER REFERENCES avaliadores(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  ('Sexismo', 6),
  ('Ódio Político', 7),
  ('Racismo', 8),
  ('Intolerância Religiosa', 9),
  ('Xenofobia', 10);

INSERT OR IGNORE INTO schema_meta (versao) VALUES (2);

INSERT OR IGNORE INTO modelos_avaliacao (chave_base, nome, descricao, versao, ativo, sistema)
VALUES ('discurso_odio', 'Discurso de ódio', 'Classificação binária com múltiplos tipos de ódio.', 1, 1, 'hate_v1');

INSERT OR IGNORE INTO schema_meta (versao) VALUES (3);

PRAGMA user_version = 3;
