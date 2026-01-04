import axios from 'axios';
import { logger } from '../utils/logger';

const RECCOBEATS_API_BASE = 'https://api.reccobeats.com/v1';

export interface ReccoBeatsTrack {
    id: string;
    trackTitle: string;
    isrc: string;
    href: string;
    popularity: number;
}

export interface AudioFeatures {
    id: string;
    href: string;
    isrc: string;
    acousticness: number;
    danceability: number;
    energy: number;
    instrumentalness: number;
    key: number;
    liveness: number;
    loudness: number;
    mode: number;
    speechiness: number;
    tempo: number;
    valence: number;
}

export interface TrackWithFeatures {
    spotifyTrackId: string;
    isrc: string;
    reccobeatsId: string | null;
    features: AudioFeatures | null;
}

class ReccoBeatsService {
    private client = axios.create({
        baseURL: RECCOBEATS_API_BASE,
        headers: {
            'Accept': 'application/json',
        },
        timeout: 10000,
    });

    /**
     * Get ReccoBeats track info by ISRC
     */
    async getTrackByIsrc(isrc: string): Promise<ReccoBeatsTrack | null> {
        try {
            const response = await this.client.get<{ content: ReccoBeatsTrack[] }>('/track', {
                params: { ids: isrc },
            });

            if (response.data.content && response.data.content.length > 0) {
                return response.data.content[0];
            }
            return null;
        } catch (error) {
            logger.debug({ isrc, err: error }, 'Failed to get ReccoBeats track');
            return null;
        }
    }

    /**
     * Get audio features for a track by ReccoBeats ID
     */
    async getAudioFeatures(reccobeatsId: string): Promise<AudioFeatures | null> {
        try {
            const response = await this.client.get<AudioFeatures>(`/track/${reccobeatsId}/audio-features`);
            return response.data;
        } catch (error) {
            logger.debug({ reccobeatsId, err: error }, 'Failed to get audio features');
            return null;
        }
    }

    /**
     * Get audio features for multiple tracks by their ISRCs
     * Uses batch processing with rate limiting
     */
    async getAudioFeaturesForTracks(
        tracks: Array<{ spotifyId: string; isrc: string | undefined }>
    ): Promise<Map<string, AudioFeatures>> {
        const featuresMap = new Map<string, AudioFeatures>();
        
        // Process in batches to avoid rate limiting
        const batchSize = 10;
        const delayMs = 100;

        for (let i = 0; i < tracks.length; i += batchSize) {
            const batch = tracks.slice(i, i + batchSize);
            
            const promises = batch.map(async (track) => {
                if (!track.isrc) return null;

                try {
                    // First get the ReccoBeats track ID
                    const reccoTrack = await this.getTrackByIsrc(track.isrc);
                    if (!reccoTrack) return null;

                    // Then get audio features
                    const features = await this.getAudioFeatures(reccoTrack.id);
                    if (features) {
                        featuresMap.set(track.spotifyId, features);
                    }
                    return features;
                } catch (error) {
                    logger.debug({ spotifyId: track.spotifyId, isrc: track.isrc }, 'Failed to get features for track');
                    return null;
                }
            });

            await Promise.all(promises);

            // Add delay between batches to avoid rate limiting
            if (i + batchSize < tracks.length) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        logger.info({ totalTracks: tracks.length, featuresFound: featuresMap.size }, 'Fetched audio features');
        return featuresMap;
    }
}

export const reccoBeatsService = new ReccoBeatsService();

/**
 * Calculate distance between two tracks based on audio features
 * Lower distance = more similar tracks
 */
export function calculateTrackDistance(a: AudioFeatures, b: AudioFeatures): number {
    // Normalize tempo difference (typically 60-200 BPM)
    const tempoDiff = Math.abs(a.tempo - b.tempo) / 140;
    
    // Key compatibility (0-11 circle of fifths)
    // Adjacent keys in circle of fifths are harmonically compatible
    const keyDiff = Math.min(
        Math.abs(a.key - b.key),
        12 - Math.abs(a.key - b.key)
    ) / 6; // Normalize to 0-1
    
    // Mode difference (major=1, minor=0)
    const modeDiff = a.mode !== b.mode ? 0.5 : 0;
    
    // Other features are already 0-1
    const energyDiff = Math.abs(a.energy - b.energy);
    const valenceDiff = Math.abs(a.valence - b.valence);
    const danceabilityDiff = Math.abs(a.danceability - b.danceability);
    
    // Weighted sum
    // Tempo and key are more important for smooth transitions
    return (
        tempoDiff * 0.3 +
        keyDiff * 0.25 +
        modeDiff * 0.1 +
        energyDiff * 0.15 +
        valenceDiff * 0.1 +
        danceabilityDiff * 0.1
    );
}

/**
 * Sort tracks for smooth transitions using nearest neighbor algorithm
 * This creates a DJ-like flow where adjacent tracks are similar
 */
export function smartSortTracks<T extends { id: string }>(
    tracks: T[],
    featuresMap: Map<string, AudioFeatures>
): T[] {
    if (tracks.length <= 1) return tracks;

    // Tracks without features will be placed at the end
    const tracksWithFeatures: T[] = [];
    const tracksWithoutFeatures: T[] = [];

    for (const track of tracks) {
        if (featuresMap.has(track.id)) {
            tracksWithFeatures.push(track);
        } else {
            tracksWithoutFeatures.push(track);
        }
    }

    if (tracksWithFeatures.length <= 1) {
        return [...tracksWithFeatures, ...tracksWithoutFeatures];
    }

    // Use nearest neighbor algorithm starting from first track
    const sorted: T[] = [];
    const remaining = new Set(tracksWithFeatures);

    // Start with the track that has highest energy (good playlist opener)
    let current = tracksWithFeatures.reduce((best, track) => {
        const bestFeatures = featuresMap.get(best.id)!;
        const trackFeatures = featuresMap.get(track.id)!;
        return trackFeatures.energy > bestFeatures.energy ? track : best;
    });

    sorted.push(current);
    remaining.delete(current);

    // Greedily pick the nearest neighbor
    while (remaining.size > 0) {
        const currentFeatures = featuresMap.get(current.id)!;
        let nearestTrack: T | null = null;
        let nearestDistance = Infinity;

        for (const track of remaining) {
            const trackFeatures = featuresMap.get(track.id)!;
            const distance = calculateTrackDistance(currentFeatures, trackFeatures);
            
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestTrack = track;
            }
        }

        if (nearestTrack) {
            sorted.push(nearestTrack);
            remaining.delete(nearestTrack);
            current = nearestTrack;
        }
    }

    // Append tracks without features at the end
    return [...sorted, ...tracksWithoutFeatures];
}
