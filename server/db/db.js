import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPasswordHash } from '../lib/password.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectDir = join(currentDir, '..', '..');
const dataDir = join(projectDir, 'data');

mkdirSync(dataDir, { recursive: true });

export function createDatabase(filename = process.env.DB_PATH || join(dataDir, 'radar-avaliacao.sqlite')) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(readFileSync(join(currentDir, 'schema.sql'), 'utf8'));
  const columns = new Set(db.prepare('PRAGMA table_info(avaliadores)').all().map((column) => column.name));
  const additions = [
    ['username', 'TEXT COLLATE NOCASE'],
    ['senha_hash', 'TEXT'],
    ['senha_salt', 'TEXT'],
    ['senha_temporaria', 'INTEGER NOT NULL DEFAULT 0 CHECK (senha_temporaria IN (0, 1))'],
    ['papel', "TEXT NOT NULL DEFAULT 'avaliador' CHECK (papel IN ('admin', 'avaliador'))"],
    ['ativo', 'INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))']
  ];
  additions.forEach(([name, definition]) => {
    if (!columns.has(name)) db.exec(`ALTER TABLE avaliadores ADD COLUMN ${name} ${definition}`);
  });
  const loteColumns = new Set(db.prepare('PRAGMA table_info(lotes)').all().map((column) => column.name));
  if (!loteColumns.has('distribuicao_conjunta')) {
    db.exec('ALTER TABLE lotes ADD COLUMN distribuicao_conjunta INTEGER NOT NULL DEFAULT 0 CHECK (distribuicao_conjunta IN (0, 1))');
  }
  const assignmentSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'lote_avaliadores'").get()?.sql || '';
  if (/ordem\s+IN\s*\(1,\s*2\)/i.test(assignmentSchema)) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE lote_avaliadores_nova (
        lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
        avaliador_id INTEGER NOT NULL REFERENCES avaliadores(id) ON DELETE RESTRICT,
        ordem INTEGER NOT NULL CHECK (ordem >= 1),
        PRIMARY KEY (lote_id, avaliador_id),
        UNIQUE (lote_id, ordem)
      );
      INSERT INTO lote_avaliadores_nova (lote_id, avaliador_id, ordem)
      SELECT lote_id, avaliador_id, ordem FROM lote_avaliadores;
      DROP TABLE lote_avaliadores;
      ALTER TABLE lote_avaliadores_nova RENAME TO lote_avaliadores;
      CREATE INDEX idx_lote_avaliadores_avaliador ON lote_avaliadores(avaliador_id, lote_id);
      COMMIT;
    `);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_avaliadores_username ON avaliadores(username COLLATE NOCASE) WHERE username IS NOT NULL;');
  db.prepare("UPDATE categorias_odio SET nome = 'Classismo' WHERE nome = 'Aporofobia'").run();
  db.prepare("UPDATE categorias_odio SET nome = 'Gordofobia' WHERE nome = 'Body Shaming'").run();
  db.prepare("UPDATE categorias_odio SET nome = 'Sexismo' WHERE nome = 'Misoginia' AND NOT EXISTS (SELECT 1 FROM categorias_odio WHERE nome = 'Sexismo')").run();
  db.exec(`
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
    INSERT OR IGNORE INTO schema_meta (versao) VALUES (2);
    PRAGMA user_version = 2;
  `);
  const admin = db.prepare("SELECT id FROM avaliadores WHERE papel = 'admin' LIMIT 1").get();
  if (!admin) {
    const username = String(process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
    const password = String(process.env.ADMIN_PASSWORD || 'Admin@Radar2026');
    const credentials = createPasswordHash(password);
    db.prepare(`
      INSERT INTO avaliadores (nome, email, username, senha_hash, senha_salt, senha_temporaria, papel, ativo)
      VALUES (?, ?, ?, ?, ?, 0, 'admin', 1)
    `).run('Administrador', process.env.ADMIN_EMAIL || 'admin@radar.local', username, credentials.hash, credentials.salt);
  }
  return db;
}

export const db = createDatabase();

export function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
