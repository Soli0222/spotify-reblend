import { pool } from '../config/database';
import { decryptSecret, encryptSecret } from '../utils/crypto';
import { spotifyService } from './spotify';

export interface SpotifyTokenUser {
    id: number;
    access_token: string | null;
    refresh_token: string | null;
    token_expires_at: Date;
}

export interface ValidAccessToken {
    accessToken: string | null;
    refreshTokenUnavailable: boolean;
}

interface GetValidAccessTokenOptions {
    onRefreshError?: (error: unknown) => void;
}

export async function getValidAccessToken(
    user: SpotifyTokenUser,
    options: GetValidAccessTokenOptions = {}
): Promise<ValidAccessToken> {
    let accessToken = decryptSecret(user.access_token);

    if (new Date(user.token_expires_at) <= new Date()) {
        try {
            const refreshToken = decryptSecret(user.refresh_token);
            if (!refreshToken) {
                return { accessToken: null, refreshTokenUnavailable: true };
            }

            const tokens = await spotifyService.refreshToken(refreshToken);
            accessToken = tokens.access_token;
            await pool.query(
                'UPDATE users SET access_token = $1, refresh_token = COALESCE($2, refresh_token), token_expires_at = $3 WHERE id = $4',
                [encryptSecret(accessToken), encryptSecret(tokens.refresh_token), new Date(Date.now() + tokens.expires_in * 1000), user.id]
            );
        } catch (error) {
            if (options.onRefreshError) {
                options.onRefreshError(error);
                return { accessToken: null, refreshTokenUnavailable: false };
            }
            throw error;
        }
    }

    return { accessToken, refreshTokenUnavailable: false };
}
