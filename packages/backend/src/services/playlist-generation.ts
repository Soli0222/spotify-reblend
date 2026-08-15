import { pool } from '../config/database';
import { blendTracks, SortMode } from './blend';
import { spotifyService, SpotifyTrack } from './spotify';
import { getValidAccessToken } from './spotify-token';
import { decryptSecret } from '../utils/crypto';
import { logger } from '../utils/logger';

export type GenerateOutcome =
    | { ok: true; spotifyPlaylistId: string; spotifyUrl: string; trackCount: number; created: boolean; memberCount: number }
    | { ok: false; reason: 'no-members' | 'no-tokens' | 'no-tracks' | 'owner-token-unavailable' };

export async function generatePlaylist(
    playlistId: number,
    options: { sortMode: SortMode; requestedBy?: number }
): Promise<GenerateOutcome> {
    const playlistResult = await pool.query(
        'SELECT * FROM playlists WHERE id = $1',
        [playlistId]
    );
    if (playlistResult.rows.length === 0) {
        throw new Error(`Playlist ${playlistId} not found`);
    }
    const playlist = playlistResult.rows[0];

    const membersResult = await pool.query(
        `SELECT u.id, u.spotify_id, u.access_token, u.refresh_token, u.token_expires_at
       FROM playlist_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.playlist_id = $1
       ORDER BY pm.created_at ASC, pm.id ASC`,
        [playlistId]
    );

    if (membersResult.rows.length === 0) {
        return { ok: false, reason: 'no-members' };
    }

    const userTracks = new Map<string, SpotifyTrack[]>();
    let ownerAccessToken: string | null = null;

    for (const member of membersResult.rows) {
        const { accessToken } = await getValidAccessToken(member, {
            onRefreshError: (error) => {
                logger.error({ err: error, memberId: member.id }, 'Failed to refresh token');
            },
        });
        if (!accessToken) continue;

        if (member.id === playlist.owner_id) {
            ownerAccessToken = accessToken;
        }

        try {
            let tracks = await spotifyService.getTopTracks(accessToken, 50);
            tracks = spotifyService.filterInstrumentalTracks(tracks);
            userTracks.set(member.spotify_id, tracks);
        } catch (error) {
            logger.error({ err: error, memberId: member.id }, 'Failed to get top tracks');
        }
    }

    if (userTracks.size === 0) {
        return { ok: false, reason: 'no-tokens' };
    }

    const { tracks } = await blendTracks(userTracks, { totalTracks: 100, sortMode: options.sortMode });

    if (tracks.length === 0) {
        return { ok: false, reason: 'no-tracks' };
    }

    const ownerResult = await pool.query(
        'SELECT spotify_id, access_token FROM users WHERE id = $1',
        [playlist.owner_id]
    );
    const owner = ownerResult.rows[0];

    if (!ownerAccessToken) {
        ownerAccessToken = decryptSecret(owner.access_token);
    }

    if (!ownerAccessToken) {
        return { ok: false, reason: 'owner-token-unavailable' };
    }

    const created = !playlist.spotify_playlist_id;
    let spotifyPlaylistId: string = playlist.spotify_playlist_id;
    let spotifyUrl = '';

    if (spotifyPlaylistId) {
        await spotifyService.clearPlaylistTracks(ownerAccessToken, spotifyPlaylistId);
        await spotifyService.addTracksToPlaylist(ownerAccessToken, spotifyPlaylistId, tracks.map(track => track.uri));
        spotifyUrl = `https://open.spotify.com/playlist/${spotifyPlaylistId}`;
    } else {
        const spotifyPlaylist = await spotifyService.createPlaylist(
            ownerAccessToken,
            owner.spotify_id,
            playlist.name,
            playlist.description || `ReBlend playlist with ${membersResult.rows.length} members`
        );
        spotifyPlaylistId = spotifyPlaylist.id;
        spotifyUrl = spotifyPlaylist.external_urls.spotify;

        await spotifyService.addTracksToPlaylist(ownerAccessToken, spotifyPlaylistId, tracks.map(track => track.uri));
        await pool.query(
            `UPDATE playlists SET spotify_playlist_id = $1, status = 'generated', updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
            [spotifyPlaylistId, playlistId]
        );

        for (const member of membersResult.rows) {
            if (member.id !== playlist.owner_id) {
                try {
                    const { accessToken } = await getValidAccessToken(member, {
                        onRefreshError: (error) => {
                            logger.error({ err: error, memberId: member.id }, 'Failed to refresh token');
                        },
                    });
                    if (accessToken) {
                        await spotifyService.followPlaylist(accessToken, spotifyPlaylistId);
                    }
                } catch (error) {
                    logger.error({ err: error, memberId: member.id }, 'Failed to follow playlist');
                }
            }
        }
    }

    if (playlist.status !== 'generated') {
        await pool.query(
            `UPDATE playlists SET status = 'generated', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [playlistId]
        );
    }

    return {
        ok: true,
        spotifyPlaylistId,
        spotifyUrl,
        trackCount: tracks.length,
        created,
        memberCount: membersResult.rows.length,
    };
}
