import { pool } from '../config/database';
import { decryptSecret, encryptSecret } from '../utils/crypto';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { isRefreshTokenPermanentlyInvalid, spotifyService } from './spotify';

export interface SpotifyTokenUser {
    id: number;
    access_token: string | null;
    refresh_token: string | null;
    token_expires_at: Date;
    token_status?: 'active' | 'invalid';
}

export interface ValidAccessToken {
    accessToken: string | null;
    refreshTokenUnavailable: boolean;
    tokenInvalid: boolean;
    expiresAt: Date | null;
}

interface GetValidAccessTokenOptions {
    onRefreshError?: (error: unknown) => void;
    forceRefresh?: boolean;
}

export async function refreshTokenInvalidUsersGauge(): Promise<void> {
    try {
        const result = await pool.query("SELECT COUNT(*) AS count FROM users WHERE token_status = 'invalid'");
        metrics.usersTokenInvalid.set(Number(result.rows[0].count));
    } catch (error) {
        logger.warn({ err: error }, 'Failed to update invalid Spotify token gauge');
    }
}

async function markRefreshTokenInvalid(userId: number): Promise<void> {
    const result = await pool.query(
        `UPDATE users
         SET token_status = 'invalid', token_invalidated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND token_status IS DISTINCT FROM 'invalid'
         RETURNING id`,
        [userId]
    );

    if (result.rows.length > 0) {
        metrics.tokenInvalidated.inc();
    }
    logger.warn({ userId, reason: 'invalid_grant' }, 'Refresh token permanently invalid');
    await refreshTokenInvalidUsersGauge();
}

export async function getValidAccessToken(
    user: SpotifyTokenUser,
    options: GetValidAccessTokenOptions = {}
): Promise<ValidAccessToken> {
    if (user.token_status === 'invalid' && !options.forceRefresh) {
        return {
            accessToken: null,
            refreshTokenUnavailable: false,
            tokenInvalid: true,
            expiresAt: null,
        };
    }

    let accessToken = decryptSecret(user.access_token);
    let expiresAt = new Date(user.token_expires_at);

    if (options.forceRefresh || expiresAt <= new Date()) {
        try {
            const refreshToken = decryptSecret(user.refresh_token);
            if (!refreshToken) {
                return { accessToken: null, refreshTokenUnavailable: true, tokenInvalid: false, expiresAt: null };
            }

            const tokens = await spotifyService.refreshToken(refreshToken);
            accessToken = tokens.access_token;
            expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
            await pool.query(
                `UPDATE users SET
                   access_token = $1,
                   refresh_token = COALESCE($2, refresh_token),
                   token_expires_at = $3,
                   token_status = 'active',
                   token_invalidated_at = NULL,
                   updated_at = CURRENT_TIMESTAMP
                 WHERE id = $4`,
                [encryptSecret(accessToken), encryptSecret(tokens.refresh_token), expiresAt, user.id]
            );
            await refreshTokenInvalidUsersGauge();
        } catch (error) {
            const tokenInvalid = isRefreshTokenPermanentlyInvalid(error);
            if (tokenInvalid) {
                await markRefreshTokenInvalid(user.id);
            }
            if (options.onRefreshError) {
                options.onRefreshError(error);
                return { accessToken: null, refreshTokenUnavailable: false, tokenInvalid, expiresAt: null };
            }
            throw error;
        }
    }

    return { accessToken, refreshTokenUnavailable: false, tokenInvalid: false, expiresAt };
}
