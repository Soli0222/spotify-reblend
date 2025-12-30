import axios from 'axios';

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

    getAuthUrl(): string {
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
        const response = await axios.get(`${SPOTIFY_API_BASE}/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        return response.data;
    }

    async getTopTracks(accessToken: string, limit: number = 50): Promise<SpotifyTrack[]> {
        const response = await axios.get(`${SPOTIFY_API_BASE}/me/top/tracks`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: {
                time_range: 'short_term', // Last 4 weeks (1 month)
                limit,
            },
        });
        return response.data.items;
    }

    /**
     * Filter out instrumental tracks based on track name patterns.
     * Note: Audio Features API was deprecated for new apps in November 2024,
     * so we use name-based heuristics instead.
     */
    filterInstrumentalTracks(tracks: SpotifyTrack[]): SpotifyTrack[] {
        // Common patterns that indicate instrumental versions
        const instrumentalPatterns = [
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
        ];

        return tracks.filter(track => {
            const name = track.name.toLowerCase();
            // Check if any pattern matches
            for (const pattern of instrumentalPatterns) {
                if (pattern.test(name)) {
                    return false; // Exclude this track
                }
            }
            return true; // Include this track
        });
    }

    async createPlaylist(
        accessToken: string,
        userId: string,
        name: string,
        description: string
    ): Promise<{ id: string; external_urls: { spotify: string } }> {
        const response = await axios.post(
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
        );
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
            await axios.post(
                `${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`,
                { uris: batch },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        }
    }

    async clearPlaylistTracks(accessToken: string, playlistId: string): Promise<void> {
        // Get current tracks
        const response = await axios.get(`${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { fields: 'items(track(uri))' },
        });

        const trackUris = response.data.items
            .filter((item: { track: { uri: string } | null }) => item.track)
            .map((item: { track: { uri: string } }) => ({ uri: item.track.uri }));

        if (trackUris.length > 0) {
            // Remove in batches of 100
            for (let i = 0; i < trackUris.length; i += 100) {
                const batch = trackUris.slice(i, i + 100);
                await axios.delete(`${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    data: { tracks: batch },
                });
            }
        }
    }

    async getPlaylistTracks(accessToken: string, playlistId: string): Promise<SpotifyTrack[]> {
        const tracks: SpotifyTrack[] = [];
        let url: string | null = `${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`;

        while (url) {
            const response: { data: { items: { track: SpotifyTrack | null }[]; next: string | null } } = await axios.get(url, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { fields: 'items(track(id,uri,name,artists(name),album(name,images))),next' },
            });

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
        await axios.put(
            `${SPOTIFY_API_BASE}/playlists/${playlistId}/followers`,
            { public: false },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );
    }

    async unfollowPlaylist(accessToken: string, playlistId: string): Promise<void> {
        await axios.delete(
            `${SPOTIFY_API_BASE}/playlists/${playlistId}/followers`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );
    }
}

export const spotifyService = new SpotifyService();
