import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router: Router = Router();

// Send invitation to a user
router.post('/playlists/:playlistId/invitations', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'];
        const { playlistId } = req.params;
        const { inviteeId } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!inviteeId) {
            return res.status(400).json({ error: 'Invitee ID is required' });
        }

        // Check if user is owner of the playlist
        const playlistResult = await pool.query(
            'SELECT * FROM playlists WHERE id = $1 AND owner_id = $2',
            [playlistId, userId]
        );

        if (playlistResult.rows.length === 0) {
            return res.status(403).json({ error: 'Only the owner can send invitations' });
        }

        // Check if invitee exists
        const inviteeResult = await pool.query(
            'SELECT id FROM users WHERE id = $1',
            [inviteeId]
        );

        if (inviteeResult.rows.length === 0) {
            return res.status(404).json({ error: 'Invitee not found' });
        }

        // Check if already a member
        const memberCheck = await pool.query(
            'SELECT id FROM playlist_members WHERE playlist_id = $1 AND user_id = $2',
            [playlistId, inviteeId]
        );

        if (memberCheck.rows.length > 0) {
            return res.status(400).json({ error: 'User is already a member' });
        }

        // Create or update invitation
        const result = await pool.query(
            `INSERT INTO invitations (playlist_id, inviter_id, invitee_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (playlist_id, invitee_id)
       DO UPDATE SET status = 'pending', updated_at = CURRENT_TIMESTAMP
       RETURNING id, status, created_at`,
            [playlistId, userId, inviteeId]
        );

        res.status(201).json({
            id: result.rows[0].id,
            playlistId: parseInt(playlistId),
            inviteeId,
            status: result.rows[0].status,
            createdAt: result.rows[0].created_at,
        });
    } catch (error) {
        console.error('Send invitation error:', error);
        res.status(500).json({ error: 'Failed to send invitation' });
    }
});

// Get user's received invitations
router.get('/invitations', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'];

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const result = await pool.query(
            `SELECT i.id, i.status, i.created_at,
              p.id as playlist_id, p.name as playlist_name,
              u.display_name as inviter_name
       FROM invitations i
       JOIN playlists p ON i.playlist_id = p.id
       JOIN users u ON i.inviter_id = u.id
       WHERE i.invitee_id = $1
       ORDER BY i.created_at DESC`,
            [userId]
        );

        res.json(result.rows.map(i => ({
            id: i.id,
            playlistId: i.playlist_id,
            playlistName: i.playlist_name,
            inviterName: i.inviter_name,
            status: i.status,
            createdAt: i.created_at,
        })));
    } catch (error) {
        console.error('Get invitations error:', error);
        res.status(500).json({ error: 'Failed to get invitations' });
    }
});

// Accept invitation
router.post('/invitations/:id/accept', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Get invitation
        const invitationResult = await pool.query(
            `SELECT * FROM invitations WHERE id = $1 AND invitee_id = $2 AND status = 'pending'`,
            [id, userId]
        );

        if (invitationResult.rows.length === 0) {
            return res.status(404).json({ error: 'Invitation not found or already processed' });
        }

        const invitation = invitationResult.rows[0];

        // Update invitation status
        await pool.query(
            `UPDATE invitations SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [id]
        );

        // Add user as playlist member
        await pool.query(
            `INSERT INTO playlist_members (playlist_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (playlist_id, user_id) DO NOTHING`,
            [invitation.playlist_id, userId]
        );

        res.json({
            message: 'Invitation accepted',
            playlistId: invitation.playlist_id,
        });
    } catch (error) {
        console.error('Accept invitation error:', error);
        res.status(500).json({ error: 'Failed to accept invitation' });
    }
});

// Decline invitation
router.post('/invitations/:id/decline', async (req: Request, res: Response) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const result = await pool.query(
            `UPDATE invitations 
       SET status = 'declined', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND invitee_id = $2 AND status = 'pending'
       RETURNING id`,
            [id, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invitation not found or already processed' });
        }

        res.json({ message: 'Invitation declined' });
    } catch (error) {
        console.error('Decline invitation error:', error);
        res.status(500).json({ error: 'Failed to decline invitation' });
    }
});

export default router;
