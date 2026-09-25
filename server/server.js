import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { avaliadoresRouter } from './routes/avaliadores.js';
import { lotesRouter } from './routes/lotes.js';
import { avaliacoesRouter } from './routes/avaliacoes.js';
import { agreementRouter } from './routes/agreement.js';
import { reconciliacoesRouter } from './routes/reconciliacoes.js';
import { exportRouter } from './routes/export.js';
import { modelosRouter } from './routes/modelos.js';
import { HttpError } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { requireAuth } from './lib/auth.js';

const app = express();
const currentDir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(currentDir, '..', 'public');
const papaParseFile = join(currentDir, '..', 'node_modules', 'papaparse', 'papaparse.min.js');
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '80mb' }));
app.get('/vendor/papaparse.min.js', (req, res) => res.sendFile(papaParseFile));
app.use(express.static(publicDir, {
  extensions: ['html'],
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store')
}));

app.get('/api/health', (req, res) => res.json({ status: 'ok', banco: 'sqlite' }));
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.use('/api/avaliadores', avaliadoresRouter);
app.use('/api/modelos-avaliacao', modelosRouter);
app.use('/api/lotes', agreementRouter);
app.use('/api/lotes', lotesRouter);
app.use('/api/avaliacoes', avaliacoesRouter);
app.use('/api/reconciliacoes', reconciliacoesRouter);
app.use('/api/lotes', exportRouter);

app.use('/api', (req, res) => res.status(404).json({ erro: 'Endpoint não encontrado.' }));
app.get('*splat', (req, res) => res.sendFile(join(publicDir, 'index.html')));

app.use((error, req, res, next) => {
  const status = error instanceof HttpError ? error.status : 500;
  if (status === 500) console.error(error);
  res.status(status).json({ erro: status === 500 ? 'Erro interno do servidor.' : error.message, detalhes: error.details });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, '0.0.0.0', () => console.log(`Radar Ódio disponível em http://localhost:${port}`));
}

export { app };
