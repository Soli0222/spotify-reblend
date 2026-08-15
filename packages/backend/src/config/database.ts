import { Pool } from 'pg';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

// Construct connection string if DATABASE_URL is missing or invalid (e.g. failed variable substitution)
let connectionString = process.env.DATABASE_URL;

if (!connectionString || connectionString.includes(':@')) {
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const db = process.env.POSTGRES_DB;
  const port = process.env.POSTGRES_PORT || '5432';
  const host = process.env.POSTGRES_HOST || 'localhost';

  if (user && password && db) {
    connectionString = `postgresql://${user}:${password}@${host}:${port}/${db}`;
  }
}

export const pool = new Pool({
  connectionString,
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectWithRetry() {
  const maxAttempts = parseInt(process.env.DB_CONNECT_ATTEMPTS || '12', 10);
  const retryDelayMs = parseInt(process.env.DB_CONNECT_RETRY_MS || '2500', 10);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await pool.connect();
    } catch (error) {
      lastError = error;
      logger.warn({ err: error, attempt, maxAttempts }, 'Database connection failed, retrying');
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs);
      }
    }
  }

  throw lastError;
}

export async function initDatabase(): Promise<void> {
  const client = await connectWithRetry();
  try {
    // Create tables if they don't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        spotify_id VARCHAR(255) UNIQUE NOT NULL,
        display_name VARCHAR(255),
        email VARCHAR(255),
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at TIMESTAMP,
        token_status VARCHAR(20) DEFAULT 'active',
        token_invalidated_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        owner_id INTEGER REFERENCES users(id),
        spotify_playlist_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        auto_update_enabled BOOLEAN DEFAULT false,
        auto_update_sort_mode VARCHAR(20) DEFAULT 'shuffle',
        last_auto_updated_at TIMESTAMP,
        last_auto_update_status VARCHAR(50),
        last_auto_update_error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS invitations (
        id SERIAL PRIMARY KEY,
        playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
        inviter_id INTEGER REFERENCES users(id),
        invitee_id INTEGER REFERENCES users(id),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(playlist_id, invitee_id)
      );

      CREATE TABLE IF NOT EXISTS playlist_members (
        id SERIAL PRIMARY KEY,
        playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        role VARCHAR(50) DEFAULT 'member',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(playlist_id, user_id)
      );

      ALTER TABLE playlists
        ADD COLUMN IF NOT EXISTS auto_update_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS auto_update_sort_mode VARCHAR(20) DEFAULT 'shuffle',
        ADD COLUMN IF NOT EXISTS last_auto_updated_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS last_auto_update_status VARCHAR(50),
        ADD COLUMN IF NOT EXISTS last_auto_update_error TEXT;

      CREATE INDEX IF NOT EXISTS idx_playlists_auto_update
        ON playlists (auto_update_enabled)
        WHERE auto_update_enabled;

      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_status VARCHAR(20) DEFAULT 'active';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_invalidated_at TIMESTAMP;
    `);
    console.log('Database tables initialized');
  } finally {
    client.release();
  }
}
