import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';

const AUTH_COOKIE = 'reblend_session';
const STATE_COOKIE = 'reblend_oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const STATE_TTL_SECONDS = 60 * 10;

export interface AuthUser {
    id: number;
    spotifyId: string;
}

declare global {
    namespace Express {
        interface Request {
            authUser?: AuthUser;
        }
    }
}

function getAuthSecret(): string {
    const secret = process.env.AUTH_SECRET;
    if (secret) return secret;

    if (process.env.NODE_ENV === 'production') {
        throw new Error('AUTH_SECRET is required in production');
    }

    return 'development-only-auth-secret';
}

function base64urlJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sign(payload: string): string {
    return crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
}

function timingSafeEqual(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function parseCookies(header: string | undefined): Record<string, string> {
    if (!header) return {};

    return header.split(';').reduce<Record<string, string>>((cookies, part) => {
        const [rawName, ...rawValue] = part.trim().split('=');
        if (!rawName || rawValue.length === 0) return cookies;
        cookies[rawName] = decodeURIComponent(rawValue.join('='));
        return cookies;
    }, {});
}

function cookieOptions(maxAgeSeconds: number): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    maxAge: number;
    path: string;
} {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: maxAgeSeconds * 1000,
        path: '/',
    };
}

function createSessionToken(user: AuthUser): string {
    const payload = base64urlJson({
        sub: user.id,
        spotifyId: user.spotifyId,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    });
    return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string): AuthUser | null {
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !timingSafeEqual(sign(payload), signature)) return null;

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        sub?: unknown;
        spotifyId?: unknown;
        exp?: unknown;
    };

    if (typeof decoded.sub !== 'number' || typeof decoded.spotifyId !== 'string' || typeof decoded.exp !== 'number') {
        return null;
    }
    if (decoded.exp <= Math.floor(Date.now() / 1000)) return null;

    return { id: decoded.sub, spotifyId: decoded.spotifyId };
}

export function setAuthCookie(res: Response, user: AuthUser): void {
    res.cookie(AUTH_COOKIE, createSessionToken(user), cookieOptions(SESSION_TTL_SECONDS));
}

export function clearAuthCookie(res: Response): void {
    res.clearCookie(AUTH_COOKIE, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
    });
}

export function createOAuthState(): string {
    return crypto.randomBytes(32).toString('base64url');
}

export function setOAuthStateCookie(res: Response, state: string): void {
    res.cookie(STATE_COOKIE, state, cookieOptions(STATE_TTL_SECONDS));
}

export function clearOAuthStateCookie(res: Response): void {
    res.clearCookie(STATE_COOKIE, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
    });
}

export function verifyOAuthState(req: Request, state: unknown): boolean {
    if (typeof state !== 'string' || state.length === 0) return false;
    const expectedState = parseCookies(req.headers.cookie)[STATE_COOKIE];
    return typeof expectedState === 'string' && timingSafeEqual(expectedState, state);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const token = parseCookies(req.headers.cookie)[AUTH_COOKIE];
    if (!token) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const user = verifySessionToken(token);
        if (!user) {
            clearAuthCookie(res);
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        req.authUser = user;
        next();
    } catch {
        clearAuthCookie(res);
        res.status(401).json({ error: 'Unauthorized' });
    }
}
