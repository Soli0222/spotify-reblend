import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { spotifyService } from '../services/spotify';

const router: Router = Router();

// Get Spotify auth URL
router.get('/login', (_req: Request, res: Response) => {
    const authUrl = spotifyService.getAuthUrl();
    res.json({ url: authUrl });
});

// Exchange code for tokens and create/update user
router.post('/callback', async (req: Request, res: Response) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Authorization code is required' });
        }

        // Exchange code for tokens
        const tokens = await spotifyService.exchangeCode(code);

        // Get user info from Spotify
        const spotifyUser = await spotifyService.getCurrentUser(tokens.access_token);

        // Calculate token expiry time
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

        // Upsert user in database
        const result = await pool.query(
            `INSERT INTO users (spotify_id, display_name, email, access_token, refresh_token, token_expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (spotify_id) 
       DO UPDATE SET 
         display_name = EXCLUDED.display_name,
         email = EXCLUDED.email,
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, users.refresh_token),
         token_expires_at = EXCLUDED.token_expires_at,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, spotify_id, display_name, email`,
            [spotifyUser.id, spotifyUser.display_name, spotifyUser.email, tokens.access_token, tokens.refresh_token, expiresAt]
        );

        const user = result.rows[0];

        res.json({
            user: {
                id: user.id,
                spotifyId: user.spotify_id,
                displayName: user.display_name,
                email: user.email,
            },
            accessToken: tokens.access_token,
            expiresAt: expiresAt.toISOString(),
        });
    } catch (error) {
        console.error('Auth callback error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// Refresh access token
router.post('/refresh', async (req: Request, res: Response) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Get user's refresh token
        const userResult = await pool.query(
            'SELECT refresh_token FROM users WHERE id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const refreshToken = userResult.rows[0].refresh_token;

        // Get new tokens from Spotify
        const tokens = await spotifyService.refreshToken(refreshToken);
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

        // Update user's tokens
        await pool.query(
            `UPDATE users SET 
         access_token = $1, 
         refresh_token = COALESCE($2, refresh_token),
         token_expires_at = $3,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
            [tokens.access_token, tokens.refresh_token, expiresAt, userId]
        );

        res.json({
            accessToken: tokens.access_token,
            expiresAt: expiresAt.toISOString(),
        });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

// Get current user info
router.get('/me', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'];

        if (!userId) {
            return res.status(401).json({ error: 'User ID header is required' });
        }

        const result = await pool.query(
            'SELECT id, spotify_id, display_name, email FROM users WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        res.json({
            id: user.id,
            spotifyId: user.spotify_id,
            displayName: user.display_name,
            email: user.email,
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

// Search users by display name or email
router.get('/users/search', async (req: Request, res: Response) => {
    try {
        const { q } = req.query;
        const currentUserId = req.headers['x-user-id'];

        if (!q || typeof q !== 'string') {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const result = await pool.query(
            `SELECT id, spotify_id, display_name, email 
       FROM users 
       WHERE (display_name ILIKE $1 OR email ILIKE $1)
         AND id != $2
       LIMIT 10`,
            [`%${q}%`, currentUserId]
        );

        res.json(result.rows.map(user => ({
            id: user.id,
            spotifyId: user.spotify_id,
            displayName: user.display_name,
            email: user.email,
        })));
    } catch (error) {
        console.error('User search error:', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
});

export default router;
