import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { NextFunction, Request, Response } from 'express';
import { AddressInfo } from 'node:net';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    blendTracks: vi.fn(),
    getTopTracks: vi.fn(),
    filterTracks: vi.fn(),
    createPlaylist: vi.fn(),
    addTracksToPlaylist: vi.fn(),
    clearPlaylistTracks: vi.fn(),
    followPlaylist: vi.fn(),
    refreshToken: vi.fn(),
    tracksFiltered: vi.fn(),
    loggerInfo: vi.fn(),
}));

vi.mock('../config/database', () => ({
    pool: { query: mocks.query },
}));

vi.mock('./blend', () => ({
    blendTracks: mocks.blendTracks,
}));

vi.mock('./spotify', () => ({
    spotifyService: {
        getTopTracks: mocks.getTopTracks,
        filterTracks: mocks.filterTracks,
        createPlaylist: mocks.createPlaylist,
        addTracksToPlaylist: mocks.addTracksToPlaylist,
        clearPlaylistTracks: mocks.clearPlaylistTracks,
        followPlaylist: mocks.followPlaylist,
        refreshToken: mocks.refreshToken,
    },
}));

vi.mock('../utils/auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        req.authUser = { id: 1, spotifyId: 'owner-spotify-id' };
        next();
    },
}));

vi.mock('../utils/http', () => ({
    rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../utils/metrics', () => ({
    metrics: {
        playlistCreated: { inc: vi.fn() },
        blendExecuted: { inc: vi.fn() },
        tracksFiltered: { inc: mocks.tracksFiltered },
    },
}));

vi.mock('../utils/logger', () => ({
    logger: {
        info: mocks.loggerInfo,
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import { generatePlaylist } from './playlist-generation';
import playlistsRouter from '../routes/playlists';

const member = {
    id: 1,
    spotify_id: 'owner-spotify-id',
    access_token: 'owner-access-token',
    refresh_token: 'owner-refresh-token',
    token_expires_at: new Date(Date.now() + 60_000),
};

const track = {
    id: 'track-1',
    uri: 'spotify:track:track-1',
    name: 'Track 1',
    artists: [{ name: 'Artist' }],
    album: { name: 'Album', images: [] },
};

function playlist(spotifyPlaylistId: string | null) {
    return {
        id: 12,
        name: 'My ReBlend',
        description: 'A blended playlist',
        owner_id: 1,
        spotify_playlist_id: spotifyPlaylistId,
        status: 'pending',
    };
}

function setSuccessfulTrackCollection() {
    mocks.getTopTracks.mockResolvedValue([track]);
    mocks.filterTracks.mockReturnValue({
        tracks: [track],
        filteredByDuration: 0,
        filteredByName: 0,
    });
    mocks.blendTracks.mockResolvedValue({ tracks: [track], contributionsByUser: new Map() });
}

async function postGenerate(): Promise<{ status: number; body: unknown }> {
    const app = express();
    app.use(express.json());
    app.use('/api/playlists', playlistsRouter);
    const server = app.listen(0, '127.0.0.1');

    try {
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const { port } = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${port}/api/playlists/12/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sortMode: 'shuffle' }),
        });

        return { status: response.status, body: await response.json() };
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

describe('generatePlaylist', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.query.mockReset();
        setSuccessfulTrackCollection();
    });

    it('creates a Spotify playlist and reports it as newly created', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [member] })
            .mockResolvedValueOnce({ rows: [{ spotify_id: 'owner-spotify-id', access_token: 'owner-access-token' }] })
            .mockResolvedValue({ rows: [] });
        mocks.createPlaylist.mockResolvedValue({
            id: 'new-spotify-playlist',
            external_urls: { spotify: 'https://open.spotify.com/playlist/new-spotify-playlist' },
        });

        await expect(generatePlaylist(12, { sortMode: 'shuffle', requestedBy: 1 })).resolves.toEqual({
            ok: true,
            spotifyPlaylistId: 'new-spotify-playlist',
            spotifyUrl: 'https://open.spotify.com/playlist/new-spotify-playlist',
            trackCount: 1,
            created: true,
            memberCount: 1,
            skippedMembers: [],
        });
        expect(mocks.createPlaylist).toHaveBeenCalledWith(
            'owner-access-token',
            'owner-spotify-id',
            'My ReBlend',
            'A blended playlist'
        );
        expect(mocks.addTracksToPlaylist).toHaveBeenCalledWith(
            'owner-access-token',
            'new-spotify-playlist',
            ['spotify:track:track-1']
        );
    });

    it('replaces an existing Spotify playlist and reports it as regenerated', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist('existing-spotify-playlist')] })
            .mockResolvedValueOnce({ rows: [member] })
            .mockResolvedValueOnce({ rows: [{ spotify_id: 'owner-spotify-id', access_token: 'owner-access-token' }] })
            .mockResolvedValue({ rows: [] });

        await expect(generatePlaylist(12, { sortMode: 'smart', requestedBy: 1 })).resolves.toMatchObject({
            ok: true,
            spotifyPlaylistId: 'existing-spotify-playlist',
            spotifyUrl: 'https://open.spotify.com/playlist/existing-spotify-playlist',
            trackCount: 1,
            created: false,
        });
        expect(mocks.clearPlaylistTracks).toHaveBeenCalledWith('owner-access-token', 'existing-spotify-playlist');
        expect(mocks.addTracksToPlaylist).toHaveBeenCalledWith(
            'owner-access-token',
            'existing-spotify-playlist',
            ['spotify:track:track-1']
        );
        expect(mocks.createPlaylist).not.toHaveBeenCalled();
    });

    it('uses the stored owner access token without refreshing when the member loop cannot obtain it', async () => {
        const otherMember = {
            ...member,
            id: 2,
            spotify_id: 'member-spotify-id',
            access_token: 'member-access-token',
        };
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [{ ...member, access_token: null }, otherMember] })
            .mockResolvedValueOnce({ rows: [{ spotify_id: 'owner-spotify-id', access_token: 'stored-owner-access-token' }] })
            .mockResolvedValue({ rows: [] });
        mocks.createPlaylist.mockResolvedValue({
            id: 'new-spotify-playlist',
            external_urls: { spotify: 'https://open.spotify.com/playlist/new-spotify-playlist' },
        });

        await expect(generatePlaylist(12, { sortMode: 'shuffle', requestedBy: 1 })).resolves.toMatchObject({
            ok: true,
            spotifyPlaylistId: 'new-spotify-playlist',
            created: true,
        });
        expect(mocks.createPlaylist).toHaveBeenCalledWith(
            'stored-owner-access-token',
            'owner-spotify-id',
            'My ReBlend',
            'A blended playlist'
        );
        expect(mocks.refreshToken).not.toHaveBeenCalled();
    });

    it('returns 200 when the route succeeds through the stored owner token fallback', async () => {
        const otherMember = {
            ...member,
            id: 2,
            spotify_id: 'member-spotify-id',
            access_token: 'member-access-token',
        };
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [{ ...member, access_token: null }, otherMember] })
            .mockResolvedValueOnce({ rows: [{ spotify_id: 'owner-spotify-id', access_token: 'stored-owner-access-token' }] })
            .mockResolvedValue({ rows: [] });
        mocks.createPlaylist.mockResolvedValue({
            id: 'new-spotify-playlist',
            external_urls: { spotify: 'https://open.spotify.com/playlist/new-spotify-playlist' },
        });

        await expect(postGenerate()).resolves.toEqual({
            status: 200,
            body: {
                message: 'Playlist generated successfully',
                spotifyPlaylistId: 'new-spotify-playlist',
                spotifyUrl: 'https://open.spotify.com/playlist/new-spotify-playlist',
                trackCount: 1,
                skippedMembers: [],
            },
        });
        expect(mocks.createPlaylist).toHaveBeenCalledWith(
            'stored-owner-access-token',
            'owner-spotify-id',
            'My ReBlend',
            'A blended playlist'
        );
        expect(mocks.refreshToken).not.toHaveBeenCalled();
    });

    it('reports invalid members using their internal user IDs', async () => {
        const invalidMember = {
            ...member,
            id: 2,
            spotify_id: 'member-spotify-id',
            display_name: 'Member needing login',
            token_status: 'invalid',
        };
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [member, invalidMember] })
            .mockResolvedValueOnce({ rows: [{ spotify_id: 'owner-spotify-id', access_token: 'owner-access-token' }] })
            .mockResolvedValue({ rows: [] });
        mocks.createPlaylist.mockResolvedValue({
            id: 'new-spotify-playlist',
            external_urls: { spotify: 'https://open.spotify.com/playlist/new-spotify-playlist' },
        });

        await expect(generatePlaylist(12, { sortMode: 'shuffle' })).resolves.toMatchObject({
            ok: true,
            skippedMembers: [{ id: 2, displayName: 'Member needing login', reason: 'token-invalid' }],
        });
        expect(mocks.getTopTracks).toHaveBeenCalledTimes(1);
    });

    it('includes skipped members in an unsuccessful generate response', async () => {
        const invalidOwner = {
            ...member,
            display_name: 'Owner needing login',
            token_status: 'invalid',
        };
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [invalidOwner] });

        await expect(postGenerate()).resolves.toEqual({
            status: 400,
            body: {
                error: 'Could not get tracks from any member',
                skippedMembers: [{ id: 1, displayName: 'Owner needing login', reason: 'token-invalid' }],
            },
        });
    });

    it('reports members with no usable tracks', async () => {
        const noTracksMember = {
            ...member,
            id: 2,
            spotify_id: 'member-spotify-id',
            display_name: 'Member without tracks',
        };
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [member, noTracksMember] })
            .mockResolvedValueOnce({ rows: [{ spotify_id: 'owner-spotify-id', access_token: 'owner-access-token' }] })
            .mockResolvedValue({ rows: [] });
        mocks.filterTracks
            .mockReturnValueOnce({ tracks: [track], filteredByDuration: 0, filteredByName: 0 })
            .mockReturnValueOnce({ tracks: [], filteredByDuration: 0, filteredByName: 0 });
        mocks.createPlaylist.mockResolvedValue({
            id: 'new-spotify-playlist',
            external_urls: { spotify: 'https://open.spotify.com/playlist/new-spotify-playlist' },
        });

        await expect(generatePlaylist(12, { sortMode: 'shuffle' })).resolves.toMatchObject({
            ok: true,
            skippedMembers: [{ id: 2, displayName: 'Member without tracks', reason: 'no-tracks' }],
        });
    });

    it('throws a descriptive error when the playlist does not exist', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [] });

        await expect(generatePlaylist(12, { sortMode: 'shuffle' })).rejects.toThrow('Playlist 12 not found');
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });

    it('keeps the existing 500 response when the playlist disappears after route authorization', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [] });

        await expect(postGenerate()).resolves.toEqual({
            status: 500,
            body: { error: 'Failed to generate playlist' },
        });
    });

    it('returns no-members when the playlist has no members', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [] });

        await expect(generatePlaylist(12, { sortMode: 'shuffle' })).resolves.toEqual({
            ok: false,
            reason: 'no-members',
            skippedMembers: [],
        });
    });

    it('returns no-tokens when no member can provide top tracks', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [{ ...member, access_token: null }] });

        await expect(generatePlaylist(12, { sortMode: 'shuffle' })).resolves.toEqual({
            ok: false,
            reason: 'no-tokens',
            skippedMembers: [],
        });
    });

    it('returns no-tracks when blending produces no tracks', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [member] });
        mocks.blendTracks.mockResolvedValue({ tracks: [], contributionsByUser: new Map() });

        await expect(generatePlaylist(12, { sortMode: 'shuffle' })).resolves.toEqual({
            ok: false,
            reason: 'no-tracks',
            skippedMembers: [],
        });
    });

    it('records track filters by reason', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [member] })
            .mockResolvedValueOnce({ rows: [{ spotify_id: 'owner-spotify-id', access_token: 'owner-access-token' }] })
            .mockResolvedValue({ rows: [] });
        mocks.filterTracks.mockReturnValue({
            tracks: [track],
            filteredByDuration: 2,
            filteredByName: 3,
        });
        mocks.createPlaylist.mockResolvedValue({
            id: 'new-spotify-playlist',
            external_urls: { spotify: 'https://open.spotify.com/playlist/new-spotify-playlist' },
        });

        await generatePlaylist(12, { sortMode: 'shuffle' });

        expect(mocks.tracksFiltered).toHaveBeenCalledWith({ reason: 'duration' }, 2);
        expect(mocks.tracksFiltered).toHaveBeenCalledWith({ reason: 'name' }, 3);
        expect(mocks.loggerInfo).toHaveBeenCalledWith({
            playlistId: 12,
            memberId: 1,
            filteredByDuration: 2,
            filteredByName: 3,
            remaining: 1,
        }, 'Filtered tracks for blend');
    });
});
