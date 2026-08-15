import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import axios from 'axios';
import express, { NextFunction, Request, Response } from 'express';
import { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    tracksFiltered: vi.fn(),
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
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

import playlistsRouter from '../routes/playlists';

const exporter = new tracing.InMemorySpanExporter();
let telemetry: NodeSDK;

const playlist = {
    id: 12,
    name: 'My ReBlend',
    description: 'A blended playlist',
    owner_id: 1,
    spotify_playlist_id: null,
    status: 'pending',
};

const member = {
    id: 1,
    spotify_id: 'owner-spotify-id',
    display_name: 'owner@example.com',
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
    duration_ms: 180_000,
};

beforeAll(() => {
    vi.stubEnv('OTEL_SDK_DISABLED', 'false');
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318');
    telemetry = new NodeSDK({
        instrumentations: [],
        spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
    });
    telemetry.start();
});

afterAll(async () => {
    await telemetry.shutdown();
    vi.unstubAllEnvs();
});

beforeEach(() => {
    exporter.reset();
    vi.restoreAllMocks();
    mocks.query.mockImplementation((query: string) => {
        if (query.includes('owner_id = $2') || query === 'SELECT * FROM playlists WHERE id = $1') {
            return Promise.resolve({ rows: [playlist] });
        }
        if (query.includes('FROM playlist_members')) {
            return Promise.resolve({ rows: [member] });
        }
        if (query.includes('SELECT spotify_id, access_token')) {
            return Promise.resolve({ rows: [{ spotify_id: member.spotify_id, access_token: member.access_token }] });
        }
        return Promise.resolve({ rows: [] });
    });
    vi.spyOn(axios, 'get').mockResolvedValue({ data: { items: [track] } });
    vi.spyOn(axios, 'post').mockImplementation(async (url: string) => ({
        data: url.includes('/users/')
            ? { id: 'new-spotify-playlist', external_urls: { spotify: 'https://open.spotify.com/playlist/new-spotify-playlist' } }
            : {},
    }));
});

afterEach(() => {
    mocks.query.mockReset();
});

async function finishedSpans() {
    await new Promise(resolve => setTimeout(resolve, 50));
    return exporter.getFinishedSpans();
}

async function postGenerate(): Promise<globalThis.Response> {
    const app = express();
    app.use(express.json());
    app.use('/api/playlists', playlistsRouter);
    const server = app.listen(0, '127.0.0.1');

    try {
        await new Promise<void>(resolve => server.once('listening', resolve));
        const { port } = server.address() as AddressInfo;
        return await fetch(`http://127.0.0.1:${port}/api/playlists/12/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sortMode: 'shuffle' }),
        });
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

describe('playlist generation tracing', () => {
    it('records generation children from the POST endpoint without sensitive attributes', async () => {
        const response = await postGenerate();

        expect(response.status).toBe(200);
        const spans = await finishedSpans();
        const generation = spans.find(span => span.name === 'playlist.generate');
        expect(generation).toBeDefined();
        expect(generation?.attributes).toMatchObject({
            'playlist.id': 12,
            'playlist.member_count': 1,
            'blend.sort_mode': 'shuffle',
            'blend.track_count': 1,
            'playlist.created': true,
        });

        for (const spanName of ['spotify.top_tracks', 'tracks.filter', 'blend.tracks', 'spotify.playlist.write']) {
            const child = spans.find(span => span.name === spanName);
            expect(child).toBeDefined();
            expect(child?.parentSpanContext?.spanId).toBe(generation?.spanContext().spanId);
        }

        expect(spans.find(span => span.name === 'spotify.top_tracks')?.attributes).toMatchObject({
            'spotify.user_id': 1,
            'spotify.track_count': 1,
        });
        expect(spans.find(span => span.name === 'tracks.filter')?.attributes).toMatchObject({
            'filter.input_count': 1,
            'filter.filtered_by_name': 0,
            'filter.filtered_by_duration': 0,
            'filter.output_count': 1,
        });
        expect(spans.find(span => span.name === 'blend.tracks')?.attributes).toMatchObject({
            'blend.user_count': 1,
            'blend.sort_mode': 'shuffle',
            'blend.total_tracks': 100,
        });

        const serializedAttributes = JSON.stringify(spans.map(span => span.attributes));
        expect(serializedAttributes).not.toContain('owner-access-token');
        expect(serializedAttributes).not.toContain('owner-refresh-token');
        expect(serializedAttributes).not.toContain('owner@example.com');
        expect(serializedAttributes).not.toContain('owner-spotify-id');
    });

    it('marks the top-track and generation spans as errors when top tracks fail', async () => {
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('Spotify unavailable'));

        const response = await postGenerate();

        expect(response.status).toBe(400);
        const spans = await finishedSpans();
        for (const spanName of ['spotify.top_tracks', 'playlist.generate']) {
            const span = spans.find(candidate => candidate.name === spanName);
            expect(span?.status.code).toBe(2);
            expect(span?.events.some(event => event.name === 'exception')).toBe(true);
        }
    });
});
