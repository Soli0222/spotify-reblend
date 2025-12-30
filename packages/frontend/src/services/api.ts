import axios from 'axios';

// When frontend is served by backend, use same origin
const API_BASE_URL = '';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add user ID header to authenticated requests
api.interceptors.request.use((config) => {
    const userId = localStorage.getItem('userId');
    if (userId) {
        config.headers['x-user-id'] = userId;
    }
    return config;
});

// Auth API
export const authApi = {
    getLoginUrl: () => api.get<{ url: string }>('/api/auth/login'),

    callback: (code: string) =>
        api.post<{
            user: { id: number; spotifyId: string; displayName: string; email: string };
            accessToken: string;
            expiresAt: string;
        }>('/api/auth/callback', { code }),

    refresh: (userId: number) =>
        api.post<{ accessToken: string; expiresAt: string }>('/api/auth/refresh', { userId }),

    getMe: () =>
        api.get<{ id: number; spotifyId: string; displayName: string; email: string }>('/api/auth/me'),

    searchUsers: (query: string) =>
        api.get<Array<{ id: number; spotifyId: string; displayName: string; email: string }>>(
            `/api/auth/users/search?q=${encodeURIComponent(query)}`
        ),
};

// Playlist API
export interface Playlist {
    id: number;
    name: string;
    description: string;
    ownerId: number;
    ownerName: string;
    spotifyPlaylistId: string | null;
    status: 'pending' | 'generated';
    role: 'owner' | 'member';
    createdAt: string;
}

export interface PlaylistDetail extends Playlist {
    userRole: 'owner' | 'member';
    members: Array<{
        id: number;
        spotifyId: string;
        displayName: string;
        role: 'owner' | 'member';
    }>;
    pendingInvitations: Array<{
        id: number;
        userId: number;
        displayName: string;
    }>;
}

export interface PlaylistTrack {
    id: string;
    name: string;
    artists: string;
    album: string;
    albumImage: string | null;
}

export const playlistApi = {
    create: (name: string, description: string) =>
        api.post<Playlist>('/api/playlists', { name, description }),

    list: () => api.get<Playlist[]>('/api/playlists'),

    get: (id: number) => api.get<PlaylistDetail>(`/api/playlists/${id}`),

    getTracks: (id: number) =>
        api.get<{ tracks: PlaylistTrack[] }>(`/api/playlists/${id}/tracks`),

    generate: (id: number) =>
        api.post<{
            message: string;
            spotifyPlaylistId: string;
            spotifyUrl: string;
            trackCount: number;
        }>(`/api/playlists/${id}/generate`),

    delete: (id: number, deleteFromSpotify: boolean = false) =>
        api.delete<{ message: string }>(`/api/playlists/${id}?deleteFromSpotify=${deleteFromSpotify}`),
};

// Invitation API
export interface Invitation {
    id: number;
    playlistId: number;
    playlistName: string;
    inviterName: string;
    status: 'pending' | 'accepted' | 'declined';
    createdAt: string;
}

export const invitationApi = {
    send: (playlistId: number, inviteeId: number) =>
        api.post(`/api/playlists/${playlistId}/invitations`, { inviteeId }),

    list: () => api.get<Invitation[]>('/api/invitations'),

    accept: (id: number) =>
        api.post<{ message: string; playlistId: number }>(`/api/invitations/${id}/accept`),

    decline: (id: number) =>
        api.post<{ message: string }>(`/api/invitations/${id}/decline`),
};

export default api;
