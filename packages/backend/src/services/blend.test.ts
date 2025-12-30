import { describe, it, expect } from 'vitest';
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
    it('should return empty result for empty input', () => {
        const result = blendTracks(new Map(), 100);
        expect(result.tracks).toHaveLength(0);
        expect(result.contributionsByUser.size).toBe(0);
    });

    it('should blend tracks from single user', () => {
        const userTracks = new Map<string, SpotifyTrack[]>();
        userTracks.set('user1', [
            createMockTrack('1', 'Track 1'),
            createMockTrack('2', 'Track 2'),
            createMockTrack('3', 'Track 3'),
        ]);

        const result = blendTracks(userTracks, 10);
        expect(result.tracks.length).toBeLessThanOrEqual(3);
        expect(result.contributionsByUser.get('user1')).toBe(3);
    });

    it('should distribute tracks evenly between users', () => {
        const userTracks = new Map<string, SpotifyTrack[]>();

        // User 1 has 10 tracks
        userTracks.set('user1', Array.from({ length: 10 }, (_, i) =>
            createMockTrack(`u1-${i}`, `User1 Track ${i}`)
        ));

        // User 2 has 10 tracks
        userTracks.set('user2', Array.from({ length: 10 }, (_, i) =>
            createMockTrack(`u2-${i}`, `User2 Track ${i}`)
        ));

        const result = blendTracks(userTracks, 10);

        // Each user should contribute ~5 tracks
        const user1Contribution = result.contributionsByUser.get('user1') || 0;
        const user2Contribution = result.contributionsByUser.get('user2') || 0;

        expect(user1Contribution).toBe(5);
        expect(user2Contribution).toBe(5);
    });

    it('should remove duplicate tracks', () => {
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

        const result = blendTracks(userTracks, 10);

        // Should have 3 unique tracks, not 4
        const uniqueIds = new Set(result.tracks.map(t => t.id));
        expect(uniqueIds.size).toBe(result.tracks.length);
    });

    it('should handle three users', () => {
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

        const result = blendTracks(userTracks, 12);

        // 12 / 3 = 4 tracks per user
        expect(result.contributionsByUser.get('user1')).toBe(4);
        expect(result.contributionsByUser.get('user2')).toBe(4);
        expect(result.contributionsByUser.get('user3')).toBe(4);
    });

    it('should handle remainder distribution', () => {
        const userTracks = new Map<string, SpotifyTrack[]>();

        userTracks.set('user1', Array.from({ length: 10 }, (_, i) =>
            createMockTrack(`u1-${i}`, `User1 Track ${i}`)
        ));
        userTracks.set('user2', Array.from({ length: 10 }, (_, i) =>
            createMockTrack(`u2-${i}`, `User2 Track ${i}`)
        ));

        // 11 tracks / 2 users = 5 each + 1 remainder
        const result = blendTracks(userTracks, 11);

        const total = (result.contributionsByUser.get('user1') || 0) +
            (result.contributionsByUser.get('user2') || 0);
        expect(total).toBe(11);
    });

    it('should limit to requested total tracks', () => {
        const userTracks = new Map<string, SpotifyTrack[]>();

        userTracks.set('user1', Array.from({ length: 100 }, (_, i) =>
            createMockTrack(`u1-${i}`, `User1 Track ${i}`)
        ));

        const result = blendTracks(userTracks, 20);
        expect(result.tracks.length).toBeLessThanOrEqual(20);
    });
});
