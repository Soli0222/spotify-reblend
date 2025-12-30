import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { spotifyService, SpotifyTrack } from '../services/spotify';
import { blendTracks } from '../services/blend';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';

const router: Router = Router();

// Create a new playlist
router.post('/', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'];
        const { name, description } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!name) {
            return res.status(400).json({ error: 'Playlist name is required' });
        }

        // Create playlist
        const result = await pool.query(
            `INSERT INTO playlists (name, description, owner_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, owner_id, status, created_at`,
            [name, description || '', userId]
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
        logger.error({ err: error, userId: req.headers['x-user-id'] }, 'Create playlist error');
        res.status(500).json({ error: 'Failed to create playlist' });
    }
});

// Get user's playlists (owned and member of)
router.get('/', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'];

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const result = await pool.query(
            `SELECT DISTINCT p.id, p.name, p.description, p.owner_id, p.spotify_playlist_id, 
              p.status, p.created_at, u.display_name as owner_name,
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
            role: p.role,
            createdAt: p.created_at,
        })));
    } catch (error) {
        logger.error({ err: error, userId: req.headers['x-user-id'] }, 'Get playlists error');
        res.status(500).json({ error: 'Failed to get playlists' });
    }
});

// Get playlist details
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

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
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

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

        let accessToken = userResult.rows[0].access_token;

        // Refresh if needed
        if (new Date(userResult.rows[0].token_expires_at) <= new Date()) {
            const tokens = await spotifyService.refreshToken(userResult.rows[0].refresh_token);
            accessToken = tokens.access_token;
            await pool.query(
                'UPDATE users SET access_token = $1, token_expires_at = $2 WHERE id = $3',
                [accessToken, new Date(Date.now() + tokens.expires_in * 1000), userId]
            );
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

// Helper function to get valid access token for a member
async function getValidAccessToken(member: {
    id: number;
    access_token: string;
    refresh_token: string;
    token_expires_at: Date;
}): Promise<string | null> {
    let accessToken = member.access_token;

    if (new Date(member.token_expires_at) <= new Date()) {
        try {
            const tokens = await spotifyService.refreshToken(member.refresh_token);
            accessToken = tokens.access_token;
            await pool.query(
                `UPDATE users SET access_token = $1, token_expires_at = $2 WHERE id = $3`,
                [accessToken, new Date(Date.now() + tokens.expires_in * 1000), member.id]
            );
        } catch (error) {
            logger.error({ err: error, memberId: member.id }, 'Failed to refresh token');
            return null;
        }
    }

    return accessToken;
}

// Generate or regenerate the blended playlist on Spotify
router.post('/:id/generate', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Check if user is owner
        const playlistResult = await pool.query(
            'SELECT * FROM playlists WHERE id = $1 AND owner_id = $2',
            [id, userId]
        );

        if (playlistResult.rows.length === 0) {
            return res.status(403).json({ error: 'Only the owner can generate the playlist' });
        }

        const playlist = playlistResult.rows[0];

        // Get all members
        const membersResult = await pool.query(
            `SELECT u.id, u.spotify_id, u.access_token, u.refresh_token, u.token_expires_at
       FROM playlist_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.playlist_id = $1`,
            [id]
        );

        if (membersResult.rows.length === 0) {
            return res.status(400).json({ error: 'No members in playlist' });
        }

        // Collect top tracks from each member
        const userTracks = new Map<string, SpotifyTrack[]>();
        let ownerAccessToken: string | null = null;

        for (const member of membersResult.rows) {
            const accessToken = await getValidAccessToken(member);
            if (!accessToken) continue;

            // Save owner's access token for later
            if (member.id === parseInt(userId as string)) {
                ownerAccessToken = accessToken;
            }

            try {
                let tracks = await spotifyService.getTopTracks(accessToken, 50);

                // Filter out instrumental tracks based on name patterns
                tracks = spotifyService.filterInstrumentalTracks(tracks);

                userTracks.set(member.spotify_id, tracks);
            } catch (error) {
                logger.error({ err: error, memberId: member.id }, 'Failed to get top tracks');
            }
        }

        if (userTracks.size === 0) {
            return res.status(400).json({ error: 'Could not get tracks from any member' });
        }

        // Blend tracks
        const { tracks } = blendTracks(userTracks, 100);

        if (tracks.length === 0) {
            return res.status(400).json({ error: 'No tracks to add to playlist' });
        }

        // Get owner's info
        const ownerResult = await pool.query(
            'SELECT spotify_id, access_token FROM users WHERE id = $1',
            [userId]
        );
        const owner = ownerResult.rows[0];

        if (!ownerAccessToken) {
            ownerAccessToken = owner.access_token;
        }

        // Ensure we have an access token
        if (!ownerAccessToken) {
            return res.status(400).json({ error: 'Owner access token not available' });
        }

        let spotifyPlaylistId: string | null = playlist.spotify_playlist_id;
        let spotifyUrl = '';

        // Check if we're regenerating an existing playlist
        if (spotifyPlaylistId) {
            // Clear existing tracks and add new ones
            await spotifyService.clearPlaylistTracks(ownerAccessToken, spotifyPlaylistId);
            const trackUris = tracks.map(t => t.uri);
            await spotifyService.addTracksToPlaylist(ownerAccessToken, spotifyPlaylistId, trackUris);
            spotifyUrl = `https://open.spotify.com/playlist/${spotifyPlaylistId}`;
        } else {
            // Create new Spotify playlist
            const spotifyPlaylist = await spotifyService.createPlaylist(
                ownerAccessToken,
                owner.spotify_id,
                playlist.name,
                playlist.description || `ReBlend playlist with ${membersResult.rows.length} members`
            );

            spotifyPlaylistId = spotifyPlaylist.id;
            spotifyUrl = spotifyPlaylist.external_urls.spotify;

            // Add tracks to playlist
            const trackUris = tracks.map(t => t.uri);
            await spotifyService.addTracksToPlaylist(ownerAccessToken, spotifyPlaylistId, trackUris);

            // Update playlist with Spotify ID
            await pool.query(
                `UPDATE playlists SET spotify_playlist_id = $1, status = 'generated', updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
                [spotifyPlaylistId, id]
            );

            // Follow playlist for all members
            for (const member of membersResult.rows) {
                if (member.id !== parseInt(userId as string)) {
                    try {
                        const accessToken = await getValidAccessToken(member);
                        if (accessToken) {
                            await spotifyService.followPlaylist(accessToken, spotifyPlaylistId);
                        }
                    } catch (error) {
                        logger.error({ err: error, memberId: member.id }, 'Failed to follow playlist');
                    }
                }
            }
        }

        // Update status if not already generated
        if (playlist.status !== 'generated') {
            await pool.query(
                `UPDATE playlists SET status = 'generated', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );
        }

        res.json({
            message: spotifyPlaylistId === playlist.spotify_playlist_id
                ? 'Playlist regenerated successfully'
                : 'Playlist generated successfully',
            spotifyPlaylistId,
            spotifyUrl,
            trackCount: tracks.length,
        });

        // Metrics & Logging
        metrics.blendExecuted.inc({ user_count: membersResult.rows.length });
        logger.info({
            playlistId: id,
            trackCount: tracks.length,
            memberCount: membersResult.rows.length
        }, 'Playlist generated');

    } catch (error) {
        logger.error({ err: error, playlistId: req.params.id }, 'Generate playlist error');
        res.status(500).json({ error: 'Failed to generate playlist' });
    }
});

// Delete playlist
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;
        const deleteFromSpotify = req.query.deleteFromSpotify === 'true';

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

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

                let accessToken = userResult.rows[0].access_token;

                // Refresh if needed
                if (new Date(userResult.rows[0].token_expires_at) <= new Date()) {
                    const tokens = await spotifyService.refreshToken(userResult.rows[0].refresh_token);
                    accessToken = tokens.access_token;
                    await pool.query(
                        'UPDATE users SET access_token = $1, token_expires_at = $2 WHERE id = $3',
                        [accessToken, new Date(Date.now() + tokens.expires_in * 1000), userId]
                    );
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
