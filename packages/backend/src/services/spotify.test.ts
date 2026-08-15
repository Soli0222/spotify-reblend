import axios from 'axios';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    INSTRUMENTAL_TRACK_NAME_PATTERNS,
    isRefreshTokenPermanentlyInvalid,
    normalizeTrackName,
    spotifyService,
} from './spotify';

const mocks = vi.hoisted(() => ({
    loggerDebug: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
    logger: {
        debug: mocks.loggerDebug,
    },
}));

// Mock track for testing
function createMockTrack(name: string, duration_ms?: number) {
    return {
        id: `track-${name.replace(/\s/g, '-')}`,
        name,
        uri: `spotify:track:${name}`,
        artists: [{ name: 'Test Artist' }],
        album: { name: 'Test Album', images: [] },
        ...(duration_ms === undefined ? {} : { duration_ms }),
    };
}

const originalMinTrackDurationMs = process.env.MIN_TRACK_DURATION_MS;

afterEach(() => {
    mocks.loggerDebug.mockClear();
    vi.restoreAllMocks();
    if (originalMinTrackDurationMs === undefined) {
        delete process.env.MIN_TRACK_DURATION_MS;
    } else {
        process.env.MIN_TRACK_DURATION_MS = originalMinTrackDurationMs;
    }
});

describe('Spotify API rate limits', () => {
    it('retries once after the Retry-After delay', async () => {
        const get = vi.spyOn(axios, 'get')
            .mockRejectedValueOnce({
                isAxiosError: true,
                response: { status: 429, headers: { 'retry-after': '0' } },
            })
            .mockResolvedValueOnce({ data: { items: [] } });

        await expect(spotifyService.getTopTracks('access-token')).resolves.toEqual([]);
        expect(get).toHaveBeenCalledTimes(2);
    });
});

describe('filterInstrumentalTracks', () => {
    it('should filter tracks with "instrumental" in name', () => {
        const tracks = [
            createMockTrack('Normal Song'),
            createMockTrack('Song (Instrumental)'),
            createMockTrack('Instrumental Version'),
        ];

        const result = spotifyService.filterInstrumentalTracks(tracks);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Normal Song');
    });

    it('should filter tracks with "inst" suffix', () => {
        const tracks = [
            createMockTrack('Normal Song'),
            createMockTrack('Song (inst)'),
            createMockTrack('Song [Inst]'),
        ];

        const result = spotifyService.filterInstrumentalTracks(tracks);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Normal Song');
    });

    it('should filter tracks with "karaoke" in name', () => {
        const tracks = [
            createMockTrack('Normal Song'),
            createMockTrack('Song - Karaoke Version'),
            createMockTrack('カラオケ版'),
        ];

        const result = spotifyService.filterInstrumentalTracks(tracks);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Normal Song');
    });

    it('should filter tracks with Japanese instrumental keywords', () => {
        const tracks = [
            createMockTrack('普通の曲'),
            createMockTrack('曲 (インストゥルメンタル)'),
            createMockTrack('オフボーカル版'),
            createMockTrack('インスト Ver'),
        ];

        const result = spotifyService.filterInstrumentalTracks(tracks);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('普通の曲');
    });

    it('should filter tracks with "off vocal" or "no vocal"', () => {
        const tracks = [
            createMockTrack('Normal Song'),
            createMockTrack('Song (Off Vocal)'),
            createMockTrack('Song - No Vocal'),
            createMockTrack('Without Vocals'),
        ];

        const result = spotifyService.filterInstrumentalTracks(tracks);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Normal Song');
    });

    it('should filter backing tracks', () => {
        const tracks = [
            createMockTrack('Normal Song'),
            createMockTrack('Song - Backing Track'),
        ];

        const result = spotifyService.filterInstrumentalTracks(tracks);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Normal Song');
    });

    it('should keep all tracks if none are instrumental', () => {
        const tracks = [
            createMockTrack('Great Song'),
            createMockTrack('Another Banger'),
            createMockTrack('Love Song'),
        ];

        const result = spotifyService.filterInstrumentalTracks(tracks);
        expect(result).toHaveLength(3);
    });

    it('should handle empty array', () => {
        const result = spotifyService.filterInstrumentalTracks([]);
        expect(result).toHaveLength(0);
    });

    it('should be case insensitive', () => {
        const tracks = [
            createMockTrack('INSTRUMENTAL VERSION'),
            createMockTrack('Instrumental'),
            createMockTrack('KARAOKE'),
        ];

        const result = spotifyService.filterInstrumentalTracks(tracks);
        expect(result).toHaveLength(0);
    });

    it.each([
        ['interlude', /\binterlude\b/i, 'Album Interlude', 'Interstellar'],
        ['Japanese interlude', /インタールード/i, 'インタールード', 'インターナショナル'],
        ['intro', /\bintro\b/i, 'Intro', 'Introduction'],
        ['outro', /\boutro\b/i, 'Song (Outro)', 'Outrovert'],
        ['skit', /\bskit\b/i, 'Skit #1', 'Skittish'],
        ['overture', /\boverture\b/i, 'Overture', 'Overturn'],
        ['Japanese overture', /序曲/i, '序曲', '前奏曲'],
    ])('filters %s titles without matching its counterexample', (_description, pattern, excludedName, keptName) => {
        expect(INSTRUMENTAL_TRACK_NAME_PATTERNS.some(candidate => (
            candidate.source === pattern.source && candidate.flags === pattern.flags
        ))).toBe(true);

        const result = spotifyService.filterInstrumentalTracks([
            createMockTrack(excludedName),
            createMockTrack(keptName),
        ]);

        expect(result.map(track => track.name)).toEqual([keptName]);
    });

    it('normalizes full-width punctuation before matching name patterns', () => {
        expect(normalizeTrackName('曲［Inst］〜')).toBe('曲[Inst]~');

        const result = spotifyService.filterInstrumentalTracks([
            createMockTrack('曲［Inst］'),
            createMockTrack('曲（Interlude）'),
            createMockTrack('Introduction〜'),
        ]);

        expect(result.map(track => track.name)).toEqual(['Introduction〜']);
    });

    it('logs each excluded track name at debug level', () => {
        spotifyService.filterInstrumentalTracks([createMockTrack('Album Interlude')]);

        expect(mocks.loggerDebug).toHaveBeenCalledWith({
            trackName: 'Album Interlude',
            pattern: '\\binterlude\\b',
        }, 'Excluded instrumental track by name pattern');
    });

    it.each([
        'SE TE NOTA',
        'ASI SE BAILA',
        'NO SE VA',
    ])('keeps all-caps regular track "%s"', trackName => {
        const result = spotifyService.filterInstrumentalTracks([createMockTrack(trackName)]);

        expect(result.map(track => track.name)).toEqual([trackName]);
    });
});

describe('isRefreshTokenPermanentlyInvalid', () => {
    function axiosError(status: number, data: unknown) {
        return {
            isAxiosError: true,
            response: { status, data },
        };
    }

    it('identifies Spotify invalid_grant responses', () => {
        expect(isRefreshTokenPermanentlyInvalid(axiosError(400, { error: 'invalid_grant' }))).toBe(true);
    });

    it('does not treat other 400 responses as permanent invalidation', () => {
        expect(isRefreshTokenPermanentlyInvalid(axiosError(400, { error: 'invalid_request' }))).toBe(false);
    });

    it('does not treat 500 responses as permanent invalidation', () => {
        expect(isRefreshTokenPermanentlyInvalid(axiosError(500, { error: 'invalid_grant' }))).toBe(false);
    });

    it('does not treat timeouts as permanent invalidation', () => {
        expect(isRefreshTokenPermanentlyInvalid({ isAxiosError: true, code: 'ECONNABORTED' })).toBe(false);
    });

    it('does not treat response bodies without an error field as permanent invalidation', () => {
        expect(isRefreshTokenPermanentlyInvalid(axiosError(400, {}))).toBe(false);
    });
});

describe('filterTracks', () => {
    it('keeps tracks exactly at or above the minimum duration', () => {
        const result = spotifyService.filterTracks([
            createMockTrack('At threshold', 90000),
            createMockTrack('Above threshold', 90001),
        ], { minDurationMs: 90000 });

        expect(result.tracks.map(track => track.name)).toEqual(['At threshold', 'Above threshold']);
        expect(result.filteredByDuration).toBe(0);
    });

    it('filters tracks below the minimum duration', () => {
        const result = spotifyService.filterTracks([
            createMockTrack('Short track', 89999),
            createMockTrack('Full song', 90001),
        ], { minDurationMs: 90000 });

        expect(result.tracks.map(track => track.name)).toEqual(['Full song']);
        expect(result.filteredByDuration).toBe(1);
    });

    it('keeps tracks with no duration to avoid dropping incomplete Spotify data', () => {
        const result = spotifyService.filterTracks([
            createMockTrack('Track without duration'),
        ], { minDurationMs: 90000 });

        expect(result.tracks.map(track => track.name)).toEqual(['Track without duration']);
        expect(result.filteredByDuration).toBe(0);
    });

    it('uses the default duration when the environment variable is unset', () => {
        delete process.env.MIN_TRACK_DURATION_MS;

        const result = spotifyService.filterTracks([createMockTrack('Short track', 89999)]);

        expect(result.tracks).toHaveLength(0);
    });

    it('uses the default duration when the environment variable is invalid', () => {
        process.env.MIN_TRACK_DURATION_MS = 'not-a-number';

        const result = spotifyService.filterTracks([createMockTrack('Short track', 89999)]);

        expect(result.tracks).toHaveLength(0);
    });

    it('uses the default duration when the environment variable is empty', () => {
        process.env.MIN_TRACK_DURATION_MS = '';

        const result = spotifyService.filterTracks([createMockTrack('Short track', 89999)]);

        expect(result.tracks).toHaveLength(0);
    });

    it('disables duration filtering when the environment variable is zero', () => {
        process.env.MIN_TRACK_DURATION_MS = '0';

        const result = spotifyService.filterTracks([createMockTrack('Short track', 1)]);

        expect(result.tracks.map(track => track.name)).toEqual(['Short track']);
        expect(result.filteredByDuration).toBe(0);
    });

    it('reports tracks matching both filters as name exclusions', () => {
        const result = spotifyService.filterTracks([
            createMockTrack('Short Song (Instrumental)', 1),
        ], { minDurationMs: 90000 });

        expect(result.tracks).toHaveLength(0);
        expect(result.filteredByName).toBe(1);
        expect(result.filteredByDuration).toBe(0);
    });

    it('counts tracks matching the added name patterns as name exclusions', () => {
        const result = spotifyService.filterTracks([
            createMockTrack('Overture', 120000),
        ], { minDurationMs: 90000 });

        expect(result.tracks).toHaveLength(0);
        expect(result.filteredByName).toBe(1);
        expect(result.filteredByDuration).toBe(0);
    });
});
