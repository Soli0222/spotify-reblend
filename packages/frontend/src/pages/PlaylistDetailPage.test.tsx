import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistDetail } from '../services/api';
import PlaylistDetailPage from './PlaylistDetailPage';

const apiMocks = vi.hoisted(() => ({
    get: vi.fn(),
    getTracks: vi.fn(),
    setAutoUpdate: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
    useAuth: () => ({ user: { id: 1 } }),
}));

vi.mock('../services/api', async () => {
    const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
    return {
        ...actual,
        playlistApi: {
            ...actual.playlistApi,
            get: apiMocks.get,
            getTracks: apiMocks.getTracks,
            setAutoUpdate: apiMocks.setAutoUpdate,
        },
    };
});

function createPlaylist(overrides: Partial<PlaylistDetail> = {}): PlaylistDetail {
    return {
        id: 1,
        name: '週末のブレンド',
        description: '',
        ownerId: 1,
        ownerName: 'オーナー',
        spotifyPlaylistId: null,
        status: 'generated',
        autoUpdateEnabled: false,
        autoUpdateSortMode: 'shuffle',
        lastAutoUpdatedAt: null,
        lastAutoUpdateStatus: null,
        role: 'owner',
        userRole: 'owner',
        createdAt: '2026-08-15T00:00:00.000Z',
        members: [{ id: 1, spotifyId: 'owner', displayName: 'オーナー', role: 'owner' }],
        pendingInvitations: [],
        ...overrides,
    };
}

function renderPage() {
    return render(
        <MemoryRouter initialEntries={['/playlists/1']}>
            <Routes>
                <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('PlaylistDetailPage auto update settings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.getTracks.mockResolvedValue({ data: { tracks: [] } });
    });

    it('allows an owner to enable automatic updates after the API responds', async () => {
        apiMocks.get.mockResolvedValue({ data: createPlaylist() });
        apiMocks.setAutoUpdate.mockResolvedValue({
            data: {
                autoUpdateEnabled: true,
                autoUpdateSortMode: 'shuffle',
                lastAutoUpdatedAt: null,
                lastAutoUpdateStatus: null,
            },
        });

        renderPage();

        const toggle = await screen.findByRole('switch', { name: '毎日自動で再生成する' });
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(apiMocks.setAutoUpdate).toHaveBeenCalledWith(1, {
                enabled: true,
                sortMode: 'shuffle',
            });
        });
        expect(toggle).toBeChecked();
    });

    it('shows automatic update settings as read-only for a member', async () => {
        apiMocks.get.mockResolvedValue({
            data: createPlaylist({ userRole: 'member', role: 'member', autoUpdateEnabled: true }),
        });

        renderPage();

        expect(await screen.findByText(/自動更新は有効です/)).toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: '毎日自動で再生成する' })).not.toBeInTheDocument();
    });

    it('disables automatic updates until the playlist has been generated', async () => {
        apiMocks.get.mockResolvedValue({ data: createPlaylist({ status: 'pending' }) });

        renderPage();

        expect(await screen.findByRole('switch', { name: '毎日自動で再生成する' })).toBeDisabled();
        expect(screen.getByText('まず一度生成してください')).toBeInTheDocument();
    });
});
