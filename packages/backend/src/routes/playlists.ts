import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { spotifyService } from '../services/spotify';
import { SortMode } from '../services/blend';
import { generatePlaylist } from '../services/playlist-generation';
import { getValidAccessToken } from '../services/spotify-token';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { requireAuth } from '../utils/auth';
import { rateLimit } from '../utils/http';

const router: Router = Router();

router.use(requireAuth);

// Create a new playlist
router.post('/', async (req: Request, res: Response) => {
    try {
        const userId = req.authUser!.id;
        const { name, description } = req.body;

        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Playlist name is required' });
        }
        const trimmedName = name.trim();
        if (trimmedName.length === 0 || trimmedName.length > 255) {
            return res.status(400).json({ error: 'Playlist name must be between 1 and 255 characters' });
        }
        if (description !== undefined && typeof description !== 'string') {
            return res.status(400).json({ error: 'Playlist description must be a string' });
        }
        const trimmedDescription = (description || '').trim().slice(0, 1000);

        // Create playlist
        const result = await pool.query(
            `INSERT INTO playlists (name, description, owner_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, owner_id, status, created_at`,
            [trimmedName, trimmedDescription, userId]
        );

        const playlist = result.rows[0];

        // Add owner as a member
        await pool.query(
            `INSERT INTO playlist_members (playlist_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
            [playlist.id, userId]
        );

        res.status(201).json({
            id: playlist.id,
            name: playlist.name,
            description: playlist.description,
            ownerId: playlist.owner_id,
            status: playlist.status,
            createdAt: playlist.created_at,
        });

        // Metrics & Logging
        metrics.playlistCreated.inc();
        logger.info({ playlistId: playlist.id, userId }, 'Playlist created');

    } catch (error) {
        logger.error({ err: error, userId: req.authUser?.id }, 'Create playlist error');
        res.status(500).json({ error: 'Failed to create playlist' });
    }
});

// Get user's playlists (owned and member of)
router.get('/', async (req: Request, res: Response) => {
    try {
        const userId = req.authUser!.id;

        const result = await pool.query(
            `SELECT DISTINCT p.id, p.name, p.description, p.owner_id, p.spotify_playlist_id, 
              p.status, p.auto_update_enabled, p.auto_update_sort_mode,
              p.last_auto_updated_at, p.last_auto_update_status, p.created_at, u.display_name as owner_name,
              pm.role
       FROM playlists p
       JOIN playlist_members pm ON p.id = pm.playlist_id
       JOIN users u ON p.owner_id = u.id
       WHERE pm.user_id = $1
       ORDER BY p.created_at DESC`,
            [userId]
        );

        res.json(result.rows.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            ownerId: p.owner_id,
            ownerName: p.owner_name,
            spotifyPlaylistId: p.spotify_playlist_id,
            status: p.status,
            autoUpdateEnabled: p.auto_update_enabled,
            autoUpdateSortMode: p.auto_update_sort_mode,
            lastAutoUpdatedAt: p.last_auto_updated_at,
            lastAutoUpdateStatus: p.last_auto_update_status,
            role: p.role,
            createdAt: p.created_at,
        })));
    } catch (error) {
        logger.error({ err: error, userId: req.authUser?.id }, 'Get playlists error');
        res.status(500).json({ error: 'Failed to get playlists' });
    }
});

// Get playlist details
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const userId = req.authUser!.id;
        const { id } = req.params;

        // Check if user is a member
        const memberCheck = await pool.query(
            'SELECT role FROM playlist_members WHERE playlist_id = $1 AND user_id = $2',
            [id, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get playlist details
        const playlistResult = await pool.query(
            `SELECT p.*, u.display_name as owner_name
       FROM playlists p
       JOIN users u ON p.owner_id = u.id
       WHERE p.id = $1`,
            [id]
        );

        if (playlistResult.rows.length === 0) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        const playlist = playlistResult.rows[0];

        // Get members
        const membersResult = await pool.query(
            `SELECT u.id, u.spotify_id, u.display_name, pm.role
       FROM playlist_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.playlist_id = $1`,
            [id]
        );

        // Get pending invitations
        const invitationsResult = await pool.query(
            `SELECT i.id, i.status, u.id as user_id, u.display_name
       FROM invitations i
       JOIN users u ON i.invitee_id = u.id
       WHERE i.playlist_id = $1 AND i.status = 'pending'`,
            [id]
        );

        res.json({
            id: playlist.id,
            name: playlist.name,
            description: playlist.description,
            ownerId: playlist.owner_id,
            ownerName: playlist.owner_name,
            spotifyPlaylistId: playlist.spotify_playlist_id,
            status: playlist.status,
            autoUpdateEnabled: playlist.auto_update_enabled,
            autoUpdateSortMode: playlist.auto_update_sort_mode,
            lastAutoUpdatedAt: playlist.last_auto_updated_at,
            lastAutoUpdateStatus: playlist.last_auto_update_status,
            createdAt: playlist.created_at,
            userRole: memberCheck.rows[0].role,
            members: membersResult.rows.map(m => ({
                id: m.id,
                spotifyId: m.spotify_id,
                displayName: m.display_name,
                role: m.role,
            })),
            pendingInvitations: invitationsResult.rows.map(i => ({
                id: i.id,
                userId: i.user_id,
                displayName: i.display_name,
            })),
        });
    } catch (error) {
        logger.error({ err: error, playlistId: req.params.id }, 'Get playlist error');
        res.status(500).json({ error: 'Failed to get playlist' });
    }
});

// Get playlist tracks from Spotify
router.get('/:id/tracks', async (req: Request, res: Response) => {
    try {
        const userId = req.authUser!.id;
        const { id } = req.params;

        // Check if user is a member
        const memberCheck = await pool.query(
            'SELECT role FROM playlist_members WHERE playlist_id = $1 AND user_id = $2',
            [id, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get playlist
        const playlistResult = await pool.query(
            'SELECT spotify_playlist_id FROM playlists WHERE id = $1',
            [id]
        );

        if (playlistResult.rows.length === 0) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        const spotifyPlaylistId = playlistResult.rows[0].spotify_playlist_id;

        if (!spotifyPlaylistId) {
            return res.json({ tracks: [] });
        }

        // Get user's access token
        const userResult = await pool.query(
            'SELECT access_token, refresh_token, token_expires_at FROM users WHERE id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { accessToken, refreshTokenUnavailable } = await getValidAccessToken(userResult.rows[0]);
        if (refreshTokenUnavailable) {
            return res.status(400).json({ error: 'Refresh token not available' });
        }
        if (!accessToken) {
            return res.status(400).json({ error: 'Access token not available' });
        }

        const tracks = await spotifyService.getPlaylistTracks(accessToken, spotifyPlaylistId);

        res.json({
            tracks: tracks.map(t => ({
                id: t.id,
                name: t.name,
                artists: t.artists.map(a => a.name).join(', '),
                album: t.album.name,
                albumImage: t.album.images[0]?.url || null,
            })),
        });
    } catch (error) {
        logger.error({ err: error, playlistId: req.params.id }, 'Get playlist tracks error');
        res.status(500).json({ error: 'Failed to get playlist tracks' });
    }
});

// Enable or disable daily automatic updates for a generated playlist
router.patch('/:id/auto-update', async (req: Request, res: Response) => {
    try {
        const userId = req.authUser!.id;
        const { id } = req.params;
        const { enabled, sortMode } = (req.body ?? {}) as { enabled?: unknown; sortMode?: unknown };

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'Auto update enabled must be a boolean' });
        }
        if (sortMode !== undefined && sortMode !== 'shuffle' && sortMode !== 'smart') {
            return res.status(400).json({ error: 'Invalid sort mode' });
        }

        // Check if user is owner
        const playlistResult = await pool.query(
            'SELECT * FROM playlists WHERE id = $1 AND owner_id = $2',
            [id, userId]
        );

        if (playlistResult.rows.length === 0) {
            return res.status(403).json({ error: 'Only the owner can update automatic updates' });
        }

        const playlist = playlistResult.rows[0];
        if (enabled && playlist.status !== 'generated') {
            return res.status(400).json({ error: 'Playlist must be generated before enabling automatic updates' });
        }

        const updatedResult = await pool.query(
            `UPDATE playlists
             SET auto_update_enabled = $1,
                 auto_update_sort_mode = COALESCE($2, auto_update_sort_mode),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $3
             RETURNING auto_update_enabled, auto_update_sort_mode, last_auto_updated_at, last_auto_update_status`,
            [enabled, sortMode, id]
        );
        const updated = updatedResult.rows[0];

        res.json({
            autoUpdateEnabled: updated.auto_update_enabled,
            autoUpdateSortMode: updated.auto_update_sort_mode,
            lastAutoUpdatedAt: updated.last_auto_updated_at,
            lastAutoUpdateStatus: updated.last_auto_update_status,
        });
    } catch (error) {
        logger.error({ err: error, playlistId: req.params.id }, 'Update automatic playlist settings error');
        res.status(500).json({ error: 'Failed to update automatic playlist settings' });
    }
});

// Generate or regenerate the blended playlist on Spotify
router.post('/:id/generate', rateLimit({ windowMs: 60_000, max: 6, keyPrefix: 'playlist-generate' }), async (req: Request, res: Response) => {
    try {
        const userId = req.authUser!.id;
        const { id } = req.params;
        const { sortMode = 'shuffle' } = req.body as { sortMode?: SortMode };

        if (sortMode !== 'shuffle' && sortMode !== 'smart') {
            return res.status(400).json({ error: 'Invalid sort mode' });
        }

        // Check if user is owner
        const playlistResult = await pool.query(
            'SELECT * FROM playlists WHERE id = $1 AND owner_id = $2',
            [id, userId]
        );

        if (playlistResult.rows.length === 0) {
            return res.status(403).json({ error: 'Only the owner can generate the playlist' });
        }

        const outcome = await generatePlaylist(Number(id), { sortMode, requestedBy: userId });

        if (!outcome.ok) {
            const errors = {
                'no-members': 'No members in playlist',
                'no-tokens': 'Could not get tracks from any member',
                'no-tracks': 'No tracks to add to playlist',
                'owner-token-unavailable': 'Owner access token not available',
            } as const;
            return res.status(400).json({ error: errors[outcome.reason] });
        }

        res.json({
            message: outcome.created ? 'Playlist generated successfully' : 'Playlist regenerated successfully',
            spotifyPlaylistId: outcome.spotifyPlaylistId,
            spotifyUrl: outcome.spotifyUrl,
            trackCount: outcome.trackCount,
        });

        // Metrics & Logging
        metrics.blendExecuted.inc({ user_count: outcome.memberCount });
        logger.info({
            playlistId: id,
            trackCount: outcome.trackCount,
            memberCount: outcome.memberCount
        }, 'Playlist generated');

    } catch (error) {
        logger.error({ err: error, playlistId: req.params.id }, 'Generate playlist error');
        res.status(500).json({ error: 'Failed to generate playlist' });
    }
});

// Delete playlist
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const userId = req.authUser!.id;
        const { id } = req.params;
        const deleteFromSpotify = req.query.deleteFromSpotify === 'true';

        // Check if user is owner
        const playlistResult = await pool.query(
            'SELECT * FROM playlists WHERE id = $1 AND owner_id = $2',
            [id, userId]
        );

        if (playlistResult.rows.length === 0) {
            return res.status(403).json({ error: 'Only the owner can delete the playlist' });
        }

        const playlist = playlistResult.rows[0];

        // Delete from Spotify if requested and playlist exists
        if (deleteFromSpotify && playlist.spotify_playlist_id) {
            try {
                const userResult = await pool.query(
                    'SELECT access_token, refresh_token, token_expires_at FROM users WHERE id = $1',
                    [userId]
                );

                const { accessToken, refreshTokenUnavailable } = await getValidAccessToken(userResult.rows[0]);

                if (refreshTokenUnavailable) {
                    throw new Error('Refresh token not available');
                }

                if (!accessToken) {
                    throw new Error('Access token not available');
                }
                await spotifyService.unfollowPlaylist(accessToken, playlist.spotify_playlist_id);
            } catch (error) {
                logger.warn({ err: error, playlistId: id }, 'Failed to unfollow Spotify playlist');
                // Continue with DB deletion even if Spotify fails
            }
        }

        // Delete related records first (foreign key constraints)
        await pool.query('DELETE FROM invitations WHERE playlist_id = $1', [id]);
        await pool.query('DELETE FROM playlist_members WHERE playlist_id = $1', [id]);
        await pool.query('DELETE FROM playlists WHERE id = $1', [id]);

        res.json({ message: 'Playlist deleted successfully' });
    } catch (error) {
        logger.error({ err: error, playlistId: req.params.id }, 'Delete playlist error');
        res.status(500).json({ error: 'Failed to delete playlist' });
    }
});

export default router;
