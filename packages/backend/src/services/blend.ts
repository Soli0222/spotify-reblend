import { SpotifyTrack } from './spotify';

/**
 * Fisher-Yates shuffle algorithm
 */
function shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/**
 * Remove duplicate tracks based on track ID
 */
function removeDuplicates(tracks: SpotifyTrack[]): SpotifyTrack[] {
    const seen = new Set<string>();
    return tracks.filter((track) => {
        if (seen.has(track.id)) {
            return false;
        }
        seen.add(track.id);
        return true;
    });
}

export interface BlendResult {
    tracks: SpotifyTrack[];
    contributionsByUser: Map<string, number>;
}

/**
 * Blend tracks from multiple users
 * 
 * @param userTracks - Map of user ID to their top tracks
 * @param totalTracks - Total number of tracks for the final playlist (default: 100)
 * @returns Blended and shuffled tracks
 */
export function blendTracks(
    userTracks: Map<string, SpotifyTrack[]>,
    totalTracks: number = 100
): BlendResult {
    const userCount = userTracks.size;
    if (userCount === 0) {
        return { tracks: [], contributionsByUser: new Map() };
    }

    // Calculate tracks per user (distribute evenly)
    const tracksPerUser = Math.floor(totalTracks / userCount);
    const remainder = totalTracks % userCount;

    const selectedTracks: SpotifyTrack[] = [];
    const contributionsByUser = new Map<string, number>();
    let extraTracksAssigned = 0;

    // Collect tracks from each user
    for (const [userId, tracks] of userTracks) {
        // Some users get one extra track to use up the remainder
        const userLimit = tracksPerUser + (extraTracksAssigned < remainder ? 1 : 0);
        if (extraTracksAssigned < remainder) {
            extraTracksAssigned++;
        }

        const userContribution = tracks.slice(0, userLimit);
        selectedTracks.push(...userContribution);
        contributionsByUser.set(userId, userContribution.length);
    }

    // Remove any duplicates (same track liked by multiple users)
    const uniqueTracks = removeDuplicates(selectedTracks);

    // Shuffle the final list
    const shuffledTracks = shuffle(uniqueTracks);

    // Trim to exactly totalTracks if we have more
    const finalTracks = shuffledTracks.slice(0, totalTracks);

    return {
        tracks: finalTracks,
        contributionsByUser,
    };
}
