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

    const contributionsByUser = new Map<string, number>();
    const userTrackLists: SpotifyTrack[][] = [];
    const seenIds = new Set<string>();

    let extraTracksAssigned = 0;

    // 1. Collect unique tracks per user
    for (const [userId, tracks] of userTracks) {
        const userLimit = tracksPerUser + (extraTracksAssigned < remainder ? 1 : 0);
        if (extraTracksAssigned < remainder) {
            extraTracksAssigned++;
        }

        const userManifest: SpotifyTrack[] = [];
        for (const track of tracks) {
            if (userManifest.length >= userLimit) break;

            if (!seenIds.has(track.id)) {
                seenIds.add(track.id);
                userManifest.push(track);
            }
        }

        // Shuffle individual user's contribution
        userTrackLists.push(shuffle(userManifest));
        contributionsByUser.set(userId, userManifest.length);
    }

    // 2. Interleave tracks (Chunked Round Robin)
    const interleavedTracks: SpotifyTrack[] = [];
    let activeLists = [...userTrackLists];

    while (activeLists.length > 0) {
        // Shuffle the order of users for this round to ensure fairness
        activeLists = shuffle(activeLists);

        const nextRoundLists: SpotifyTrack[][] = [];
        for (const list of activeLists) {
            const track = list.shift();
            if (track) {
                interleavedTracks.push(track);
            }

            if (list.length > 0) {
                nextRoundLists.push(list);
            }
        }
        activeLists = nextRoundLists;
    }

    // 3. Final trim
    const finalTracks = interleavedTracks.slice(0, totalTracks);

    return {
        tracks: finalTracks,
        contributionsByUser,
    };
}
