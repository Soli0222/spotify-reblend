import { describe, it, expect } from 'vitest';
import { spotifyService } from './spotify';

// Mock track for testing
function createMockTrack(name: string) {
    return {
        id: `track-${name.replace(/\s/g, '-')}`,
        name,
        uri: `spotify:track:${name}`,
        artists: [{ name: 'Test Artist' }],
        album: { name: 'Test Album', images: [] },
    };
}

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
