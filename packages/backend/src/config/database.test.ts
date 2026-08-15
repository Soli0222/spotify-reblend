import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    connect: vi.fn(),
    query: vi.fn(),
    release: vi.fn(),
}));

vi.mock('pg', () => ({
    Pool: class {
        connect = mocks.connect;
    },
}));

vi.mock('../utils/logger', () => ({
    logger: {
        warn: vi.fn(),
    },
}));

import { initDatabase } from './database';

describe('initDatabase', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
        mocks.query.mockResolvedValue(undefined);
    });

    it('applies automatic update columns and its partial index idempotently', async () => {
        await initDatabase();
        await initDatabase();

        expect(mocks.query).toHaveBeenCalledTimes(2);
        for (const [statement] of mocks.query.mock.calls) {
            expect(statement).toContain('ADD COLUMN IF NOT EXISTS auto_update_enabled BOOLEAN DEFAULT false');
            expect(statement).toContain("ADD COLUMN IF NOT EXISTS auto_update_sort_mode VARCHAR(20) DEFAULT 'shuffle'");
            expect(statement).toContain('ADD COLUMN IF NOT EXISTS last_auto_updated_at TIMESTAMP');
            expect(statement).toContain('ADD COLUMN IF NOT EXISTS last_auto_update_status VARCHAR(50)');
            expect(statement).toContain('ADD COLUMN IF NOT EXISTS last_auto_update_error TEXT');
            expect(statement).toContain('CREATE INDEX IF NOT EXISTS idx_playlists_auto_update');
            expect(statement).toContain('WHERE auto_update_enabled');
        }
        expect(mocks.release).toHaveBeenCalledTimes(2);
    });
});
