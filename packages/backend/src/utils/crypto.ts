import crypto from 'crypto';

const ENCRYPTED_PREFIX = 'enc:v1:';

function getEncryptionKey(): Buffer | null {
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!rawKey) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('TOKEN_ENCRYPTION_KEY is required in production');
        }
        return null;
    }

    const key = rawKey.length === 64 && /^[0-9a-f]+$/i.test(rawKey)
        ? Buffer.from(rawKey, 'hex')
        : crypto.createHash('sha256').update(rawKey).digest();

    if (key.length !== 32) {
        throw new Error('TOKEN_ENCRYPTION_KEY must resolve to 32 bytes');
    }

    return key;
}

export function encryptSecret(value: string | null | undefined): string | null {
    if (!value) return null;

    const key = getEncryptionKey();
    if (!key) return value;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${ENCRYPTED_PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

export function decryptSecret(value: string | null | undefined): string | null {
    if (!value) return null;
    if (!value.startsWith(ENCRYPTED_PREFIX)) return value;

    const key = getEncryptionKey();
    if (!key) {
        throw new Error('TOKEN_ENCRYPTION_KEY is required to decrypt stored tokens');
    }

    const payload = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64url');
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
