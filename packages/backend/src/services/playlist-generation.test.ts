import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    blendTracks: vi.fn(),
    getTopTracks: vi.fn(),
    filterInstrumentalTracks: vi.fn(),
    createPlaylist: vi.fn(),
    addTracksToPlaylist: vi.fn(),
    clearPlaylistTracks: vi.fn(),
    followPlaylist: vi.fn(),
    refreshToken: vi.fn(),
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
        filterInstrumentalTracks: mocks.filterInstrumentalTracks,
        createPlaylist: mocks.createPlaylist,
        addTracksToPlaylist: mocks.addTracksToPlaylist,
        clearPlaylistTracks: mocks.clearPlaylistTracks,
        followPlaylist: mocks.followPlaylist,
        refreshToken: mocks.refreshToken,
    },
}));

import { generatePlaylist } from './playlist-generation';

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
    mocks.filterInstrumentalTracks.mockReturnValue([track]);
    mocks.blendTracks.mockResolvedValue({ tracks: [track], contributionsByUser: new Map() });
}

describe('generatePlaylist', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

    it('returns no-members when the playlist has no members', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [] });

        await expect(generatePlaylist(12, { sortMode: 'shuffle' })).resolves.toEqual({
            ok: false,
            reason: 'no-members',
        });
    });

    it('returns no-tokens when no member can provide top tracks', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [playlist(null)] })
            .mockResolvedValueOnce({ rows: [{ ...member, access_token: null }] });

        await expect(generatePlaylist(12, { sortMode: 'shuffle' })).resolves.toEqual({
            ok: false,
            reason: 'no-tokens',
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
        });
    });
});
