import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

const apiMocks = vi.hoisted(() => ({
    list: vi.fn(),
    invitations: vi.fn(),
    login: vi.fn(),
    user: {
        id: 1,
        spotifyId: 'owner',
        displayName: 'オーナー',
        email: 'owner@example.com',
        tokenStatus: 'invalid' as const,
    },
}));

vi.mock('../contexts/AuthContext', () => ({
    useAuth: () => ({ user: apiMocks.user, login: apiMocks.login, logout: vi.fn() }),
}));

vi.mock('../services/api', async () => {
    const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
    return {
        ...actual,
        playlistApi: { ...actual.playlistApi, list: apiMocks.list },
        invitationApi: { ...actual.invitationApi, list: apiMocks.invitations },
    };
});

describe('DashboardPage Spotify connection warning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.list.mockResolvedValue({ data: [] });
        apiMocks.invitations.mockResolvedValue({ data: [] });
    });

    it('shows a re-login warning when the current user has an invalid Spotify connection', async () => {
        render(
            <MemoryRouter>
                <DashboardPage />
            </MemoryRouter>
        );

        expect(await screen.findByRole('alert')).toHaveTextContent('Spotifyとの連携が切れています。再ログインしてください');
        fireEvent.click(screen.getByRole('button', { name: 'Spotifyで再ログイン' }));
        expect(apiMocks.login).toHaveBeenCalledOnce();
    });
});
