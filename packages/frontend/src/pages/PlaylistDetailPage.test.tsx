import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistDetail, User } from '../services/api';
import PlaylistDetailPage from './PlaylistDetailPage';

const apiMocks = vi.hoisted(() => ({
    get: vi.fn(),
    getTracks: vi.fn(),
    generate: vi.fn(),
    setAutoUpdate: vi.fn(),
    login: vi.fn(),
    user: {
        id: 1,
        spotifyId: 'owner',
        displayName: 'オーナー',
        email: 'owner@example.com',
        tokenStatus: 'active',
    } as User,
}));

vi.mock('../contexts/AuthContext', () => ({
    useAuth: () => ({ user: apiMocks.user, login: apiMocks.login }),
}));

vi.mock('../services/api', async () => {
    const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
    return {
        ...actual,
        playlistApi: {
            ...actual.playlistApi,
            get: apiMocks.get,
            getTracks: apiMocks.getTracks,
            generate: apiMocks.generate,
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
        members: [{ id: 1, spotifyId: 'owner', displayName: 'オーナー', role: 'owner', tokenStatus: 'active' }],
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

describe('PlaylistDetailPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.user = {
            id: 1,
            spotifyId: 'owner',
            displayName: 'オーナー',
            email: 'owner@example.com',
            tokenStatus: 'active',
        };
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

    it('shows a re-login warning when the current user has an invalid Spotify connection', async () => {
        apiMocks.user = { ...apiMocks.user, tokenStatus: 'invalid' };
        apiMocks.get.mockResolvedValue({
            data: createPlaylist({
                members: [{ id: 1, spotifyId: 'owner', displayName: 'オーナー', role: 'owner', tokenStatus: 'invalid' }],
            }),
        });

        renderPage();

        expect(await screen.findByRole('alert')).toHaveTextContent('Spotifyとの連携が切れています。再ログインしてください');
        fireEvent.click(screen.getByRole('button', { name: 'Spotifyで再ログイン' }));
        expect(apiMocks.login).toHaveBeenCalledOnce();
    });

    it('warns about another member with an invalid Spotify connection before generation', async () => {
        apiMocks.get.mockResolvedValue({
            data: createPlaylist({
                members: [
                    { id: 1, spotifyId: 'owner', displayName: 'オーナー', role: 'owner', tokenStatus: 'active' },
                    { id: 2, spotifyId: 'member', displayName: 'メンバー', role: 'member', tokenStatus: 'invalid' },
                ],
            }),
        });

        renderPage();

        expect(await screen.findByText('⚠️ 連携切れ')).toBeInTheDocument();
        expect(screen.getByText(/メンバーさんのSpotify連携が切れているため、曲は含まれません/)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('does not show connection warnings when every member is active', async () => {
        apiMocks.get.mockResolvedValue({ data: createPlaylist() });

        renderPage();

        await screen.findByText('週末のブレンド');
        expect(screen.queryByText('⚠️ 連携切れ')).not.toBeInTheDocument();
        expect(screen.queryByText(/Spotifyとの連携が切れています/)).not.toBeInTheDocument();
        expect(screen.queryByText(/曲は含まれません/)).not.toBeInTheDocument();
    });

    it('shows members whose tracks could not be fetched after generation', async () => {
        apiMocks.get.mockResolvedValue({ data: createPlaylist() });
        apiMocks.generate.mockResolvedValue({
            data: {
                message: 'Playlist generated successfully',
                spotifyPlaylistId: 'playlist-id',
                spotifyUrl: 'https://open.spotify.com/playlist/playlist-id',
                trackCount: 10,
                skippedMembers: [{ id: 2, displayName: 'メンバー', reason: 'token-invalid' }],
            },
        });

        renderPage();

        fireEvent.click(await screen.findByRole('button', { name: 'プレイリストを再生成' }));
        expect(await screen.findByText('メンバーさんの曲は取得できませんでした')).toBeInTheDocument();
    });

    it('shows a partial auto update status', async () => {
        apiMocks.get.mockResolvedValue({ data: createPlaylist({ lastAutoUpdateStatus: 'partial' }) });

        renderPage();

        expect(await screen.findByText('一部メンバーの曲を取得できませんでした')).toBeInTheDocument();
    });

    it('ignores unknown auto update statuses', async () => {
        apiMocks.get.mockResolvedValue({ data: createPlaylist({ lastAutoUpdateStatus: 'unknown-status' }) });

        renderPage();

        await screen.findByText('週末のブレンド');
        expect(screen.queryByText('一部メンバーの曲を取得できませんでした')).not.toBeInTheDocument();
        expect(screen.queryByText('直近の自動更新に失敗しました')).not.toBeInTheDocument();
    });
});
