import axios from 'axios';

// When frontend is served by backend, use same origin
const API_BASE_URL = '';

const api = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
    },
});

export type TokenStatus = 'active' | 'invalid';

export interface User {
    id: number;
    spotifyId: string;
    displayName: string;
    email: string;
    tokenStatus: TokenStatus;
}

export type AuthCallbackUser = Omit<User, 'tokenStatus'>;

export interface SkippedMember {
    id: number;
    displayName: string | null;
    reason: 'token-invalid' | 'no-tracks';
}

// Auth API
export const authApi = {
    getLoginUrl: () => api.get<{ url: string }>('/api/auth/login'),

    callback: (code: string, state: string) =>
        api.post<{
            user: AuthCallbackUser;
            expiresAt: string;
        }>('/api/auth/callback', { code, state }),

    refresh: () =>
        api.post<{ expiresAt: string }>('/api/auth/refresh'),

    getMe: () =>
        api.get<User>('/api/auth/me'),

    logout: () => api.post<{ message: string }>('/api/auth/logout'),

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
    autoUpdateEnabled: boolean;
    autoUpdateSortMode: SortMode;
    lastAutoUpdatedAt: string | null;
    lastAutoUpdateStatus: string | null;
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
        tokenStatus: TokenStatus;
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

export type SortMode = 'shuffle' | 'smart';

export const playlistApi = {
    create: (name: string, description: string) =>
        api.post<Playlist>('/api/playlists', { name, description }),

    list: () => api.get<Playlist[]>('/api/playlists'),

    get: (id: number) => api.get<PlaylistDetail>(`/api/playlists/${id}`),

    getTracks: (id: number) =>
        api.get<{ tracks: PlaylistTrack[] }>(`/api/playlists/${id}/tracks`),

    generate: (id: number, sortMode: SortMode = 'shuffle') =>
        api.post<{
            message: string;
            spotifyPlaylistId: string;
            spotifyUrl: string;
            trackCount: number;
            skippedMembers: SkippedMember[];
        }>(`/api/playlists/${id}/generate`, { sortMode }),

    setAutoUpdate: (id: number, settings: { enabled: boolean; sortMode?: SortMode }) =>
        api.patch<{
            autoUpdateEnabled: boolean;
            autoUpdateSortMode: SortMode;
            lastAutoUpdatedAt: string | null;
            lastAutoUpdateStatus: string | null;
        }>(`/api/playlists/${id}/auto-update`, settings),

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
