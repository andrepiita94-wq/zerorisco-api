import express from 'express';
import cors from 'cors';
import pg from 'pg';

const { Pool } = pg;
const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

async function migrate() {
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
  console.log('[DB] Migrated and cleaned up expired incidents');
}

app.get('/api/healthz', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/incidents', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, type, lat, lng, reported_at, expires_at FROM incidents WHERE expires_at > NOW() ORDER BY reported_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /incidents error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/incidents', async (req, res) => {
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/incidents/:id', async (req, res) => {
  await pool.query('DELETE FROM incidents WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

const port = parseInt(process.env.PORT || '3000', 10);

migrate()
  .then(() => app.listen(port, () => console.log(`ZeroRisco API rodando na porta ${port}`)))
  .catch(err => { console.error('Erro fatal:', err); process.exit(1); });
