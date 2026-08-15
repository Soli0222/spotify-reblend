import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { NextFunction, Request, Response } from 'express';
import { AddressInfo } from 'node:net';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
}));

vi.mock('../config/database', () => ({
    pool: { query: mocks.query },
}));

vi.mock('../utils/auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        req.authUser = { id: 1, spotifyId: 'owner-spotify-id' };
        next();
    },
}));

vi.mock('../services/spotify', () => ({
    spotifyService: {},
}));

vi.mock('../services/playlist-generation', () => ({
    generatePlaylist: vi.fn(),
}));

vi.mock('../services/spotify-token', () => ({
    getValidAccessToken: vi.fn(),
}));

vi.mock('../utils/http', () => ({
    rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../utils/metrics', () => ({
    metrics: {
        playlistCreated: { inc: vi.fn() },
        blendExecuted: { inc: vi.fn() },
    },
}));

vi.mock('../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import playlistsRouter from './playlists';

async function request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const app = express();
    app.use(express.json());
    app.use('/api/playlists', playlistsRouter);
    const server = app.listen(0, '127.0.0.1');

    try {
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const { port } = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

describe('playlist automatic update routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.query.mockReset();
    });

    it('rejects updates from users who do not own the playlist', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [] });

        await expect(request('PATCH', '/api/playlists/12/auto-update', { enabled: true })).resolves.toEqual({
            status: 403,
            body: { error: 'Only the owner can update automatic updates' },
        });
        expect(mocks.query).toHaveBeenCalledWith(
            'SELECT * FROM playlists WHERE id = $1 AND owner_id = $2',
            ['12', 1]
        );
    });

    it('rejects a missing or non-boolean enabled value before querying the database', async () => {
        await expect(request('PATCH', '/api/playlists/12/auto-update')).resolves.toEqual({
            status: 400,
            body: { error: 'Auto update enabled must be a boolean' },
        });
        await expect(request('PATCH', '/api/playlists/12/auto-update', {})).resolves.toEqual({
            status: 400,
            body: { error: 'Auto update enabled must be a boolean' },
        });
        await expect(request('PATCH', '/api/playlists/12/auto-update', { enabled: 'true' })).resolves.toEqual({
            status: 400,
            body: { error: 'Auto update enabled must be a boolean' },
        });
        expect(mocks.query).not.toHaveBeenCalled();
    });

    it('rejects an invalid sort mode before querying the database', async () => {
        await expect(request('PATCH', '/api/playlists/12/auto-update', {
            enabled: true,
            sortMode: 'alphabetical',
        })).resolves.toEqual({
            status: 400,
            body: { error: 'Invalid sort mode' },
        });
        expect(mocks.query).not.toHaveBeenCalled();
    });

    it('does not enable automatic updates before the playlist has been generated', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ id: 12, status: 'pending' }] });

        await expect(request('PATCH', '/api/playlists/12/auto-update', { enabled: true })).resolves.toEqual({
            status: 400,
            body: { error: 'Playlist must be generated before enabling automatic updates' },
        });
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });

    it('updates settings for the owner and returns the persisted values', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [{ id: 12, status: 'generated' }] })
            .mockResolvedValueOnce({
                rows: [{
                    auto_update_enabled: true,
                    auto_update_sort_mode: 'smart',
                    last_auto_updated_at: null,
                    last_auto_update_status: null,
                }],
            });

        await expect(request('PATCH', '/api/playlists/12/auto-update', {
            enabled: true,
            sortMode: 'smart',
        })).resolves.toEqual({
            status: 200,
            body: {
                autoUpdateEnabled: true,
                autoUpdateSortMode: 'smart',
                lastAutoUpdatedAt: null,
                lastAutoUpdateStatus: null,
            },
        });
    });

    it('includes automatic update state in playlist lists', async () => {
        mocks.query.mockResolvedValueOnce({
            rows: [{
                id: 12,
                name: 'My ReBlend',
                description: 'A blended playlist',
                owner_id: 1,
                owner_name: 'Owner',
                spotify_playlist_id: 'spotify-playlist',
                status: 'generated',
                auto_update_enabled: true,
                auto_update_sort_mode: 'shuffle',
                last_auto_updated_at: '2026-08-15T00:00:00.000Z',
                last_auto_update_status: 'success',
                role: 'owner',
                created_at: '2026-08-01T00:00:00.000Z',
            }],
        });

        await expect(request('GET', '/api/playlists')).resolves.toEqual({
            status: 200,
            body: [expect.objectContaining({
                autoUpdateEnabled: true,
                autoUpdateSortMode: 'shuffle',
                lastAutoUpdatedAt: '2026-08-15T00:00:00.000Z',
                lastAutoUpdateStatus: 'success',
            })],
        });
    });

    it('includes automatic update state in playlist details', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [{ role: 'owner' }] })
            .mockResolvedValueOnce({
                rows: [{
                    id: 12,
                    name: 'My ReBlend',
                    description: 'A blended playlist',
                    owner_id: 1,
                    owner_name: 'Owner',
                    spotify_playlist_id: 'spotify-playlist',
                    status: 'generated',
                    auto_update_enabled: true,
                    auto_update_sort_mode: 'smart',
                    last_auto_updated_at: '2026-08-15T00:00:00.000Z',
                    last_auto_update_status: 'partial',
                    created_at: '2026-08-01T00:00:00.000Z',
                }],
            })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        await expect(request('GET', '/api/playlists/12')).resolves.toEqual({
            status: 200,
            body: expect.objectContaining({
                autoUpdateEnabled: true,
                autoUpdateSortMode: 'smart',
                lastAutoUpdatedAt: '2026-08-15T00:00:00.000Z',
                lastAutoUpdateStatus: 'partial',
            }),
        });
    });
});
