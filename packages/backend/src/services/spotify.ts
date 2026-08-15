import axios from 'axios';
import { logger } from '../utils/logger';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_AUTH_BASE = 'https://accounts.spotify.com';

export interface SpotifyTokens {
    access_token: string;
    refresh_token: string;
    expires_in: number;
}

export interface SpotifyUser {
    id: string;
    display_name: string;
    email: string;
}

export interface SpotifyTrack {
    id: string;
    uri: string;
    name: string;
    artists: { name: string }[];
    album: { name: string; images: { url: string }[] };
    duration_ms?: number;
    external_ids?: {
        isrc?: string;
    };
}

export interface TrackFilterOptions {
    minDurationMs?: number;
}

export interface TrackFilterResult {
    tracks: SpotifyTrack[];
    filteredByDuration: number;
    filteredByName: number;
}

const DEFAULT_MIN_TRACK_DURATION_MS = 90000;
const MAX_RATE_LIMIT_RETRY_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMs(error: unknown): number | null {
    if (!axios.isAxiosError(error) || error.response?.status !== 429) {
        return null;
    }

    const retryAfter = error.response.headers?.['retry-after'];
    const seconds = Number(retryAfter);
    const delayMs = seconds * 1000;
    return Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= MAX_RATE_LIMIT_RETRY_DELAY_MS
        ? delayMs
        : null;
}

async function retryOnRateLimit<T>(request: () => Promise<T>): Promise<T> {
    try {
        return await request();
    } catch (error) {
        const delayMs = retryAfterMs(error);
        if (delayMs === null) {
            throw error;
        }
        await sleep(delayMs);
        return request();
    }
}

export function isRefreshTokenPermanentlyInvalid(error: unknown): boolean {
    if (!axios.isAxiosError(error) || error.response?.status !== 400) {
        return false;
    }

    const responseData = error.response.data;
    return typeof responseData === 'object'
        && responseData !== null
        && 'error' in responseData
        && responseData.error === 'invalid_grant';
}

export const INSTRUMENTAL_TRACK_NAME_PATTERNS: readonly RegExp[] = [
    /\binstrumental\b/i,
    /インストゥルメンタル/i,
    /インスト/i,
    /\bkaraoke\b/i,
    /カラオケ/i,
    /\boff vocal\b/i,
    /オフボーカル/i,
    /\b-?inst\.?\b/i,
    /\(inst\.?\)/i,
    /\[inst\.?\]/i,
    /\bno vocals?\b/i,
    /\bwithout vocals?\b/i,
    /\bbacking track\b/i,
    /\binterlude\b/i,
    /インタールード/i,
    /\bintro\b/i,
    /\boutro\b/i,
    /\bskit\b/i,
    /\boverture\b/i,
    /序曲/i,
];

export function normalizeTrackName(name: string): string {
    return name.normalize('NFKC').replace(/[〜～]/g, '~');
}

export class SpotifyService {
    private clientId: string;
    private clientSecret: string;
    private redirectUri: string;

    constructor() {
        this.clientId = process.env.SPOTIFY_CLIENT_ID || '';
        this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';
        this.redirectUri = process.env.SPOTIFY_REDIRECT_URI || '';
    }

    getAuthUrl(state: string): string {
        const scopes = [
            'user-read-private',
            'user-read-email',
            'user-top-read',
            'playlist-modify-public',
            'playlist-modify-private',
        ].join(' ');

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.clientId,
            scope: scopes,
            redirect_uri: this.redirectUri,
            state,
            show_dialog: 'true',
        });

        return `${SPOTIFY_AUTH_BASE}/authorize?${params.toString()}`;
    }

    async exchangeCode(code: string): Promise<SpotifyTokens> {
        const response = await axios.post(
            `${SPOTIFY_AUTH_BASE}/api/token`,
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: this.redirectUri,
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
                },
            }
        );

        return response.data;
    }

    async refreshToken(refreshToken: string): Promise<SpotifyTokens> {
        const response = await axios.post(
            `${SPOTIFY_AUTH_BASE}/api/token`,
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
                },
            }
        );

        return response.data;
    }

    async getCurrentUser(accessToken: string): Promise<SpotifyUser> {
        const response = await retryOnRateLimit(() => axios.get(`${SPOTIFY_API_BASE}/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        }));
        return response.data;
    }

    async getTopTracks(accessToken: string, limit: number = 50): Promise<SpotifyTrack[]> {
        const response = await retryOnRateLimit(() => axios.get(`${SPOTIFY_API_BASE}/me/top/tracks`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: {
                time_range: 'short_term', // Last 4 weeks (1 month)
                limit,
            },
        }));
        return response.data.items;
    }

    /**
     * Filter out instrumental tracks based on track name patterns.
     * Note: Audio Features API was deprecated for new apps in November 2024,
     * so we use name-based heuristics instead.
     */
    filterInstrumentalTracks(tracks: SpotifyTrack[]): SpotifyTrack[] {
        return tracks.filter(track => {
            const name = normalizeTrackName(track.name);
            for (const pattern of INSTRUMENTAL_TRACK_NAME_PATTERNS) {
                if (pattern.test(name)) {
                    logger.debug({ trackName: track.name, pattern: pattern.source }, 'Excluded instrumental track by name pattern');
                    return false;
                }
            }
            return true;
        });
    }

    filterShortTracks(tracks: SpotifyTrack[], minDurationMs: number): SpotifyTrack[] {
        if (minDurationMs === 0) {
            return tracks;
        }

        return tracks.filter(track => track.duration_ms === undefined || track.duration_ms >= minDurationMs);
    }

    filterTracks(tracks: SpotifyTrack[], options: TrackFilterOptions = {}): TrackFilterResult {
        const minDurationMs = options.minDurationMs ?? this.getMinTrackDurationMs();
        const tracksWithoutInstrumentals = this.filterInstrumentalTracks(tracks);
        const filteredTracks = this.filterShortTracks(tracksWithoutInstrumentals, minDurationMs);

        return {
            tracks: filteredTracks,
            filteredByName: tracks.length - tracksWithoutInstrumentals.length,
            filteredByDuration: tracksWithoutInstrumentals.length - filteredTracks.length,
        };
    }

    private getMinTrackDurationMs(): number {
        const configuredDuration = process.env.MIN_TRACK_DURATION_MS;

        if (!configuredDuration || configuredDuration.trim() === '') {
            return DEFAULT_MIN_TRACK_DURATION_MS;
        }

        const parsedDuration = Number(configuredDuration);
        if (!Number.isFinite(parsedDuration) || parsedDuration < 0) {
            return DEFAULT_MIN_TRACK_DURATION_MS;
        }

        return parsedDuration;
    }

    async createPlaylist(
        accessToken: string,
        userId: string,
        name: string,
        description: string
    ): Promise<{ id: string; external_urls: { spotify: string } }> {
        const response = await retryOnRateLimit(() => axios.post(
            `${SPOTIFY_API_BASE}/users/${userId}/playlists`,
            {
                name,
                description,
                public: false,
                collaborative: true,
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        ));
        return response.data;
    }

    async addTracksToPlaylist(
        accessToken: string,
        playlistId: string,
        trackUris: string[]
    ): Promise<void> {
        // Spotify allows max 100 tracks per request
        for (let i = 0; i < trackUris.length; i += 100) {
            const batch = trackUris.slice(i, i + 100);
            await retryOnRateLimit(() => axios.post(
                `${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`,
                { uris: batch },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            ));
        }
    }

    async clearPlaylistTracks(accessToken: string, playlistId: string): Promise<void> {
        // Get current tracks
        const response = await retryOnRateLimit(() => axios.get(`${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { fields: 'items(track(uri))' },
        }));

        const trackUris = response.data.items
            .filter((item: { track: { uri: string } | null }) => item.track)
            .map((item: { track: { uri: string } }) => ({ uri: item.track.uri }));

        if (trackUris.length > 0) {
            // Remove in batches of 100
            for (let i = 0; i < trackUris.length; i += 100) {
                const batch = trackUris.slice(i, i + 100);
                await retryOnRateLimit(() => axios.delete(`${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    data: { tracks: batch },
                }));
            }
        }
    }

    async getPlaylistTracks(accessToken: string, playlistId: string): Promise<SpotifyTrack[]> {
        const tracks: SpotifyTrack[] = [];
        let url: string | null = `${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`;

        while (url) {
            const response: { data: { items: { track: SpotifyTrack | null }[]; next: string | null } } = await retryOnRateLimit(() => axios.get(url!, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { fields: 'items(track(id,uri,name,artists(name),album(name,images))),next' },
            }));

            for (const item of response.data.items) {
                if (item.track) {
                    tracks.push(item.track);
                }
            }

            url = response.data.next;
        }

        return tracks;
    }

    async followPlaylist(accessToken: string, playlistId: string): Promise<void> {
        await retryOnRateLimit(() => axios.put(
            `${SPOTIFY_API_BASE}/playlists/${playlistId}/followers`,
            { public: false },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        ));
    }

    async unfollowPlaylist(accessToken: string, playlistId: string): Promise<void> {
        await retryOnRateLimit(() => axios.delete(
            `${SPOTIFY_API_BASE}/playlists/${playlistId}/followers`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        ));
    }
}

export const spotifyService = new SpotifyService();
