import { Pool } from 'pg';
import dotenv from 'dotenv';

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

export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
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
    `);
    console.log('Database tables initialized');
  } finally {
    client.release();
  }
}
