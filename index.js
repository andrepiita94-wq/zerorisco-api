import express from 'express';
import cors from 'cors';
import pg from 'pg';

const { Pool } = pg;
const app = express();

app.use(cors());
app.use(express.json());

// Inicia mesmo sem DATABASE_URL — falha graciosamente por request
let pool = null;
let dbReady = false;

async function initDb() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.warn('[DB] DATABASE_URL não configurada — rodando sem banco de dados');
    return;
  }
  try {
    pool = new Pool({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        type TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )
    `);
    await pool.query('DELETE FROM incidents WHERE expires_at < NOW()');
    dbReady = true;
    console.log('[DB] Conectado e migrado com sucesso');
  } catch (err) {
    console.error('[DB] Erro ao conectar:', err.message);
    pool = null;
  }
}

app.get('/api/healthz', (_req, res) => {
  res.json({ status: 'ok', db: dbReady, time: new Date().toISOString() });
});

app.get('/api/incidents', async (_req, res) => {
  if (!pool) return res.json([]);
  try {
    const { rows } = await pool.query(
      'SELECT id, type, lat, lng, reported_at, expires_at FROM incidents WHERE expires_at > NOW() ORDER BY reported_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /incidents error:', err.message);
    res.status(500).json({ error: 'Erro no banco de dados' });
  }
});

app.post('/api/incidents', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco de dados não configurado' });
  const { type, lat, lng } = req.body ?? {};
  if (!type || lat == null || lng == null) {
    return res.status(400).json({ error: 'type, lat e lng são obrigatórios' });
  }
  const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
  try {
    const { rows } = await pool.query(
      'INSERT INTO incidents (type, lat, lng, expires_at) VALUES ($1, $2, $3, $4) RETURNING *',
      [type, Number(lat), Number(lng), expiresAt]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /incidents error:', err.message);
    res.status(500).json({ error: 'Erro no banco de dados' });
  }
});

app.delete('/api/incidents/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Banco de dados não configurado' });
  try {
    await pool.query('DELETE FROM incidents WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /incidents error:', err.message);
    res.status(500).json({ error: 'Erro no banco de dados' });
  }
});

const port = parseInt(process.env.PORT || '3000', 10);

// Inicia o servidor ANTES de conectar ao banco
app.listen(port, () => {
  console.log(`ZeroRisco API rodando na porta ${port}`);
  // Conecta ao banco em background (sem bloquear o startup)
  initDb().catch(err => console.error('[DB] Falha na inicialização:', err.message));
});
