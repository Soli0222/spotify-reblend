import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    refreshToken: vi.fn(),
    isRefreshTokenPermanentlyInvalid: vi.fn(),
    loggerWarn: vi.fn(),
    tokenInvalidated: vi.fn(),
    usersTokenInvalid: vi.fn(),
}));

vi.mock('../config/database', () => ({
    pool: { query: mocks.query },
}));

vi.mock('./spotify', () => ({
    spotifyService: { refreshToken: mocks.refreshToken },
    isRefreshTokenPermanentlyInvalid: mocks.isRefreshTokenPermanentlyInvalid,
}));

vi.mock('../utils/logger', () => ({
    logger: { warn: mocks.loggerWarn },
}));

vi.mock('../utils/metrics', () => ({
    metrics: {
        tokenInvalidated: { inc: mocks.tokenInvalidated },
        usersTokenInvalid: { set: mocks.usersTokenInvalid },
    },
}));

import { getValidAccessToken } from './spotify-token';

const expiredUser = {
    id: 42,
    access_token: 'old-access-token',
    refresh_token: 'refresh-token',
    token_expires_at: new Date(0),
    token_status: 'active' as const,
};

describe('getValidAccessToken', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('persists invalid status only for permanently invalid refresh tokens', async () => {
        const refreshError = new Error('invalid grant');
        mocks.refreshToken.mockRejectedValue(refreshError);
        mocks.isRefreshTokenPermanentlyInvalid.mockReturnValue(true);
        mocks.query
            .mockResolvedValueOnce({ rows: [{ id: expiredUser.id }] })
            .mockResolvedValueOnce({ rows: [{ count: '1' }] });

        await expect(getValidAccessToken(expiredUser, { onRefreshError: vi.fn() })).resolves.toMatchObject({
            accessToken: null,
            tokenInvalid: true,
        });

        expect(mocks.query).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("SET token_status = 'invalid'"),
            [expiredUser.id]
        );
        expect(mocks.tokenInvalidated).toHaveBeenCalledOnce();
        expect(mocks.usersTokenInvalid).toHaveBeenCalledWith(1);
        expect(mocks.loggerWarn).toHaveBeenCalledWith(
            { userId: expiredUser.id, reason: 'invalid_grant' },
            'Refresh token permanently invalid'
        );
    });

    it('does not change token status for a temporary refresh failure', async () => {
        mocks.refreshToken.mockRejectedValue(new Error('timeout'));
        mocks.isRefreshTokenPermanentlyInvalid.mockReturnValue(false);

        await expect(getValidAccessToken(expiredUser, { onRefreshError: vi.fn() })).resolves.toMatchObject({
            accessToken: null,
            tokenInvalid: false,
        });

        expect(mocks.query).not.toHaveBeenCalled();
        expect(mocks.tokenInvalidated).not.toHaveBeenCalled();
    });

    it('restores active status after a successful forced refresh', async () => {
        mocks.refreshToken.mockResolvedValue({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
        });
        mocks.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ count: '0' }] });

        await expect(getValidAccessToken({ ...expiredUser, token_status: 'invalid' }, { forceRefresh: true })).resolves.toMatchObject({
            accessToken: 'new-access-token',
            tokenInvalid: false,
        });

        expect(mocks.query).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("token_status = 'active'"),
            expect.arrayContaining(['new-access-token', 'new-refresh-token', expiredUser.id])
        );
        expect(mocks.usersTokenInvalid).toHaveBeenCalledWith(0);
    });
});
