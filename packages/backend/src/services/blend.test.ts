import { describe, it, expect, vi, afterEach } from 'vitest';
import { blendTracks } from './blend';
import { SpotifyTrack } from './spotify';

// Helper to create mock tracks
function createMockTrack(id: string, name: string): SpotifyTrack {
    return {
        id,
        name,
        uri: `spotify:track:${id}`,
        artists: [{ name: 'Test Artist' }],
        album: { name: 'Test Album', images: [] },
    };
}

describe('blendTracks', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return empty result for empty input', async () => {
        const result = await blendTracks(new Map());
        expect(result.tracks).toHaveLength(0);
        expect(result.contributionsByUser.size).toBe(0);
    });

    it('should blend tracks from single user', async () => {
        const userTracks = new Map<string, SpotifyTrack[]>();
        userTracks.set('user1', [
            createMockTrack('1', 'Track 1'),
            createMockTrack('2', 'Track 2'),
            createMockTrack('3', 'Track 3'),
        ]);

        const result = await blendTracks(userTracks, { totalTracks: 10 });
        expect(result.tracks.length).toBeLessThanOrEqual(3);
        expect(result.contributionsByUser.get('user1')).toBe(3);
    });

    it('should distribute tracks evenly between users', async () => {
        const userTracks = new Map<string, SpotifyTrack[]>();

        // User 1 has 10 tracks
        userTracks.set('user1', Array.from({ length: 10 }, (_, i) =>
            createMockTrack(`u1-${i}`, `User1 Track ${i}`)
        ));

        // User 2 has 10 tracks
        userTracks.set('user2', Array.from({ length: 10 }, (_, i) =>
            createMockTrack(`u2-${i}`, `User2 Track ${i}`)
        ));

        const result = await blendTracks(userTracks, { totalTracks: 10 });

        // Each user should contribute ~5 tracks
        const user1Contribution = result.contributionsByUser.get('user1') || 0;
        const user2Contribution = result.contributionsByUser.get('user2') || 0;

        expect(user1Contribution).toBe(5);
        expect(user2Contribution).toBe(5);
    });

    it('should remove duplicate tracks', async () => {
        const userTracks = new Map<string, SpotifyTrack[]>();

        // Both users have the same track
        const sharedTrack = createMockTrack('shared', 'Shared Track');

        userTracks.set('user1', [
            sharedTrack,
            createMockTrack('u1-1', 'User1 Track 1'),
        ]);

        userTracks.set('user2', [
            sharedTrack, // duplicate
            createMockTrack('u2-1', 'User2 Track 1'),
        ]);

        const result = await blendTracks(userTracks, { totalTracks: 10 });

        // Should have 3 unique tracks, not 4
        const uniqueIds = new Set(result.tracks.map(t => t.id));
        expect(uniqueIds.size).toBe(result.tracks.length);
    });

    it('should handle three users', async () => {
        const userTracks = new Map<string, SpotifyTrack[]>();

        userTracks.set('user1', Array.from({ length: 10 }, (_, i) =>
            createMockTrack(`u1-${i}`, `User1 Track ${i}`)
        ));
        userTracks.set('user2', Array.from({ length: 10 }, (_, i) =>
            createMockTrack(`u2-${i}`, `User2 Track ${i}`)
        ));
        userTracks.set('user3', Array.from({ length: 10 }, (_, i) =>
            createMockTrack(`u3-${i}`, `User3 Track ${i}`)
        ));

        const result = await blendTracks(userTracks, { totalTracks: 12 });

        // 12 / 3 = 4 tracks per user
        expect(result.contributionsByUser.get('user1')).toBe(4);
        expect(result.contributionsByUser.get('user2')).toBe(4);
        expect(result.contributionsByUser.get('user3')).toBe(4);
    });

    it('should handle remainder distribution', async () => {
        const userTracks = new Map<string, SpotifyTrack[]>();

        userTracks.set('user1', Array.from({ length: 10 }, (_, i) =>
            createMockTrack(`u1-${i}`, `User1 Track ${i}`)
        ));
        userTracks.set('user2', Array.from({ length: 10 }, (_, i) =>
            createMockTrack(`u2-${i}`, `User2 Track ${i}`)
        ));

        // 11 tracks / 2 users = 5 each + 1 remainder
        const result = await blendTracks(userTracks, { totalTracks: 11 });

        const total = (result.contributionsByUser.get('user1') || 0) +
            (result.contributionsByUser.get('user2') || 0);
        expect(total).toBe(11);
    });

    it('should limit to requested total tracks', async () => {
        const userTracks = new Map<string, SpotifyTrack[]>();

        userTracks.set('user1', Array.from({ length: 100 }, (_, i) =>
            createMockTrack(`u1-${i}`, `User1 Track ${i}`)
        ));

        const result = await blendTracks(userTracks, { totalTracks: 20 });
        expect(result.tracks.length).toBeLessThanOrEqual(20);
    });
    it('should preserve member order across round-robin rounds', async () => {
        const userTracks = new Map<string, SpotifyTrack[]>();

        userTracks.set('user1', Array.from({ length: 5 }, (_, i) =>
            createMockTrack(`u1-${i}`, `User1 Track ${i}`)
        ));
        userTracks.set('user2', Array.from({ length: 5 }, (_, i) =>
            createMockTrack(`u2-${i}`, `User2 Track ${i}`)
        ));
        userTracks.set('user3', Array.from({ length: 5 }, (_, i) =>
            createMockTrack(`u3-${i}`, `User3 Track ${i}`)
        ));

        vi.spyOn(Math, 'random').mockReturnValue(0);

        const result = await blendTracks(userTracks, { totalTracks: 15 });

        expect(result.tracks.map(t => t.id)).toEqual([
            'u1-1', 'u2-1', 'u3-1',
            'u1-2', 'u2-2', 'u3-2',
            'u1-3', 'u2-3', 'u3-3',
            'u1-4', 'u2-4', 'u3-4',
            'u1-0', 'u2-0', 'u3-0',
        ]);
    });

    it('should use shuffle mode by default', async () => {
        const userTracks = new Map<string, SpotifyTrack[]>();
        userTracks.set('user1', [
            createMockTrack('1', 'Track 1'),
            createMockTrack('2', 'Track 2'),
        ]);

        // Default should work without specifying sortMode
        const result = await blendTracks(userTracks);
        expect(result.tracks.length).toBe(2);
    });
});
