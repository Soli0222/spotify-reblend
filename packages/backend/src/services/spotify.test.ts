import { afterEach, describe, it, expect } from 'vitest';
import { spotifyService } from './spotify';

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
    if (originalMinTrackDurationMs === undefined) {
        delete process.env.MIN_TRACK_DURATION_MS;
    } else {
        process.env.MIN_TRACK_DURATION_MS = originalMinTrackDurationMs;
    }
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
            createMockTrack('Short interlude', 89999),
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

        const result = spotifyService.filterTracks([createMockTrack('Short interlude', 89999)]);

        expect(result.tracks).toHaveLength(0);
    });

    it('uses the default duration when the environment variable is invalid', () => {
        process.env.MIN_TRACK_DURATION_MS = 'not-a-number';

        const result = spotifyService.filterTracks([createMockTrack('Short interlude', 89999)]);

        expect(result.tracks).toHaveLength(0);
    });

    it('uses the default duration when the environment variable is empty', () => {
        process.env.MIN_TRACK_DURATION_MS = '';

        const result = spotifyService.filterTracks([createMockTrack('Short interlude', 89999)]);

        expect(result.tracks).toHaveLength(0);
    });

    it('disables duration filtering when the environment variable is zero', () => {
        process.env.MIN_TRACK_DURATION_MS = '0';

        const result = spotifyService.filterTracks([createMockTrack('Short interlude', 1)]);

        expect(result.tracks.map(track => track.name)).toEqual(['Short interlude']);
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
});
