import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { playlistApi, authApi, invitationApi, PlaylistDetail, PlaylistTrack, SortMode } from '../services/api';
import './PlaylistDetailPage.css';

interface SearchUser {
    id: number;
    spotifyId: string;
    displayName: string;
    email: string;
}

export default function PlaylistDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Tracks state
    const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
    const [isLoadingTracks, setIsLoadingTracks] = useState(false);

    // Invite state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [inviteError, setInviteError] = useState<string | null>(null);

    // Generate state
    const [isGenerating, setIsGenerating] = useState(false);
    const [generateResult, setGenerateResult] = useState<{
        spotifyUrl: string;
        trackCount: number;
        message: string;
    } | null>(null);
    const [sortMode, setSortMode] = useState<SortMode>('shuffle');

    // Auto update state
    const [isUpdatingAutoUpdate, setIsUpdatingAutoUpdate] = useState(false);
    const [autoUpdateError, setAutoUpdateError] = useState<string | null>(null);

    // Delete state
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    useEffect(() => {
        loadPlaylist();
    }, [id]);

    useEffect(() => {
        if (playlist?.spotifyPlaylistId) {
            loadTracks();
        }
    }, [playlist?.spotifyPlaylistId]);

    const loadPlaylist = async () => {
        if (!id) return;

        try {
            const response = await playlistApi.get(parseInt(id));
            setPlaylist(response.data);
        } catch (err) {
            console.error('Failed to load playlist:', err);
            setError('プレイリストの読み込みに失敗しました');
        } finally {
            setIsLoading(false);
        }
    };

    const loadTracks = async () => {
        if (!id) return;

        setIsLoadingTracks(true);
        try {
            const response = await playlistApi.getTracks(parseInt(id));
            setTracks(response.data.tracks);
        } catch (err) {
            console.error('Failed to load tracks:', err);
        } finally {
            setIsLoadingTracks(false);
        }
    };

    const handleSearch = async (query: string) => {
        setSearchQuery(query);

        if (query.length < 2) {
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        try {
            const response = await authApi.searchUsers(query);
            // Filter out existing members and pending invitations
            const existingIds = new Set([
                ...playlist!.members.map(m => m.id),
                ...playlist!.pendingInvitations.map(i => i.userId),
            ]);
            setSearchResults(response.data.filter(u => !existingIds.has(u.id)));
        } catch (err) {
            console.error('Search failed:', err);
        } finally {
            setIsSearching(false);
        }
    };

    const handleInvite = async (inviteeId: number) => {
        if (!id) return;

        setInviteError(null);
        try {
            await invitationApi.send(parseInt(id), inviteeId);
            setSearchQuery('');
            setSearchResults([]);
            await loadPlaylist();
        } catch (err) {
            console.error('Failed to invite:', err);
            setInviteError('招待の送信に失敗しました');
        }
    };

    const handleGenerate = async () => {
        if (!id) return;

        setIsGenerating(true);
        setError(null);
        setGenerateResult(null);

        try {
            const response = await playlistApi.generate(parseInt(id), sortMode);
            setGenerateResult({
                spotifyUrl: response.data.spotifyUrl,
                trackCount: response.data.trackCount,
                message: response.data.message,
            });
            await loadPlaylist();
            await loadTracks();
        } catch (err) {
            console.error('Failed to generate:', err);
            setError('プレイリストの生成に失敗しました');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDelete = async (deleteFromSpotify: boolean) => {
        if (!id) return;

        setIsDeleting(true);
        try {
            await playlistApi.delete(parseInt(id), deleteFromSpotify);
            navigate('/dashboard');
        } catch (err) {
            console.error('Failed to delete:', err);
            setError('プレイリストの削除に失敗しました');
            setIsDeleting(false);
            setShowDeleteConfirm(false);
        }
    };

    const handleAutoUpdate = async (enabled: boolean, autoUpdateSortMode: SortMode) => {
        if (!id || !playlist || isUpdatingAutoUpdate) return;

        setIsUpdatingAutoUpdate(true);
        setAutoUpdateError(null);

        try {
            const response = await playlistApi.setAutoUpdate(parseInt(id), {
                enabled,
                sortMode: autoUpdateSortMode,
            });
            setPlaylist(currentPlaylist => currentPlaylist ? {
                ...currentPlaylist,
                ...response.data,
            } : currentPlaylist);
        } catch (err) {
            console.error('Failed to update auto update settings:', err);
            setAutoUpdateError('自動更新の設定に失敗しました');
        } finally {
            setIsUpdatingAutoUpdate(false);
        }
    };

    const formatAutoUpdateTime = (value: string) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;

        const twoDigits = (number: number) => String(number).padStart(2, '0');
        return `${date.getFullYear()}/${twoDigits(date.getMonth() + 1)}/${twoDigits(date.getDate())} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
    };

    if (isLoading) {
        return (
            <div className="detail-loading">
                <div className="spinner"></div>
            </div>
        );
    }

    if (error && !playlist) {
        return (
            <div className="detail-error">
                <p>{error}</p>
                <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
                    ダッシュボードに戻る
                </button>
            </div>
        );
    }

    if (!playlist) return null;

    const isOwner = playlist.userRole === 'owner';
    const canGenerate = isOwner && playlist.members.length >= 1;
    const isRegenerate = playlist.status === 'generated';

    return (
        <div className="playlist-detail-page">
            <div className="container">
                <div className="detail-content animate-slideUp">
                    <div className="page-header">
                        <Link to="/dashboard" className="back-link">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M19 12H5M12 19l-7-7 7-7" />
                            </svg>
                            ダッシュボードに戻る
                        </Link>
                    </div>

                    {/* Playlist Info */}
                    <div className="detail-header card">
                        <div className="detail-title-row">
                            <h1 className="detail-title">{playlist.name}</h1>
                            <span className={`badge badge-${playlist.status === 'generated' ? 'success' : 'pending'}`}>
                                {playlist.status === 'generated' ? '生成済み' : '準備中'}
                            </span>
                        </div>
                        {playlist.description && (
                            <p className="detail-description">{playlist.description}</p>
                        )}
                        <div className="detail-meta">
                            <span>作成者: {playlist.ownerName}</span>
                            <span>メンバー: {playlist.members.length}人</span>
                        </div>
                    </div>

                    {/* Success message */}
                    {generateResult && (
                        <div className="success-card card animate-slideUp">
                            <div className="success-icon">🎉</div>
                            <h2>{generateResult.message}</h2>
                            <p>{generateResult.trackCount}曲がブレンドされました</p>
                            <a
                                href={generateResult.spotifyUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-primary"
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 14.36c-.18.27-.52.36-.79.18-2.19-1.34-4.94-1.64-8.18-.9-.31.07-.62-.12-.69-.43-.07-.31.12-.62.43-.69 3.54-.81 6.58-.46 9.05 1.05.27.18.36.52.18.79zm1.22-2.71c-.22.34-.68.44-1.02.22-2.5-1.54-6.32-1.98-9.28-1.08-.38.12-.78-.09-.9-.47-.12-.38.09-.78.47-.9 3.38-1.03 7.58-.53 10.51 1.23.34.22.44.68.22 1.02zm.1-2.82c-3-1.78-7.95-1.95-10.82-1.08-.46.14-.95-.12-1.09-.58-.14-.46.12-.95.58-1.09 3.3-1 8.77-.81 12.23 1.24.42.25.56.79.31 1.21-.25.42-.79.56-1.21.31z" />
                                </svg>
                                Spotifyで開く
                            </a>
                        </div>
                    )}

                    {/* Track List */}
                    {playlist.status === 'generated' && (
                        <section className="detail-section">
                            <h2 className="section-title">
                                <span className="section-icon">🎵</span>
                                プレイリストの曲 ({tracks.length}曲)
                            </h2>
                            {isLoadingTracks ? (
                                <div className="tracks-loading">
                                    <div className="spinner"></div>
                                </div>
                            ) : tracks.length > 0 ? (
                                <div className="track-list">
                                    {tracks.map((track, index) => (
                                        <div key={`${track.id}-${index}`} className="track-item card">
                                            {track.albumImage && (
                                                <img
                                                    src={track.albumImage}
                                                    alt={track.album}
                                                    className="track-image"
                                                />
                                            )}
                                            <div className="track-info">
                                                <span className="track-name">{track.name}</span>
                                                <span className="track-artists">{track.artists}</span>
                                            </div>
                                            <span className="track-album">{track.album}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="no-tracks">曲が見つかりませんでした</p>
                            )}
                        </section>
                    )}

                    {/* Members */}
                    <section className="detail-section">
                        <h2 className="section-title">
                            <span className="section-icon">👥</span>
                            メンバー
                        </h2>
                        <div className="member-list">
                            {playlist.members.map((member) => (
                                <div key={member.id} className="member-item card">
                                    <div className="member-avatar">
                                        {member.displayName.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="member-info">
                                        <span className="member-name">
                                            {member.displayName}
                                            {member.id === user?.id && ' (あなた)'}
                                        </span>
                                        <span className={`badge badge-${member.role}`}>
                                            {member.role === 'owner' ? 'オーナー' : 'メンバー'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Pending invitations */}
                        {playlist.pendingInvitations.length > 0 && (
                            <div className="pending-invites">
                                <h3 className="subsection-title">招待中</h3>
                                {playlist.pendingInvitations.map((inv) => (
                                    <div key={inv.id} className="member-item card pending">
                                        <div className="member-avatar pending">
                                            {inv.displayName.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="member-info">
                                            <span className="member-name">{inv.displayName}</span>
                                            <span className="badge badge-pending">承諾待ち</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Invite section (owner only) */}
                    {isOwner && (
                        <section className="detail-section">
                            <h2 className="section-title">
                                <span className="section-icon">📨</span>
                                メンバーを招待
                            </h2>
                            <div className="invite-form card">
                                <div className="search-input-wrapper">
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="ユーザー名またはメールで検索..."
                                        value={searchQuery}
                                        onChange={(e) => handleSearch(e.target.value)}
                                    />
                                    {isSearching && <div className="search-spinner"></div>}
                                </div>

                                {inviteError && (
                                    <div className="form-error">{inviteError}</div>
                                )}

                                {searchResults.length > 0 && (
                                    <div className="search-results">
                                        {searchResults.map((result) => (
                                            <div key={result.id} className="search-result-item">
                                                <div className="result-info">
                                                    <span className="result-name">{result.displayName}</span>
                                                    <span className="result-email">{result.email}</span>
                                                </div>
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    onClick={() => handleInvite(result.id)}
                                                >
                                                    招待
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                                    <p className="no-results">ユーザーが見つかりませんでした</p>
                                )}
                            </div>
                        </section>
                    )}

                    {/* Generate section */}
                    {isOwner && (
                        <section className="detail-section">
                            <h2 className="section-title">
                                <span className="section-icon">{isRegenerate ? '🔄' : '🎵'}</span>
                                {isRegenerate ? 'プレイリストを再生成' : 'プレイリストを生成'}
                            </h2>
                            <div className="generate-card card">
                                <p className="generate-info">
                                    メンバー全員の過去1ヶ月のトップ曲をブレンドして、
                                    100曲のプレイリストを作成します。
                                    <br />
                                    <small>※ インストゥルメンタル曲は自動的に除外されます</small>
                                </p>

                                <div className="sort-mode-selector">
                                    <label className="sort-mode-label">曲の並び順:</label>
                                    <div className="sort-mode-options">
                                        <label className={`sort-mode-option ${sortMode === 'shuffle' ? 'selected' : ''}`}>
                                            <input
                                                type="radio"
                                                name="sortMode"
                                                value="shuffle"
                                                checked={sortMode === 'shuffle'}
                                                onChange={() => setSortMode('shuffle')}
                                            />
                                            <span className="sort-mode-icon">🎲</span>
                                            <span className="sort-mode-text">
                                                <span className="sort-mode-title">シャッフル</span>
                                                <span className="sort-mode-desc">ランダムに並べる</span>
                                            </span>
                                        </label>
                                        <label className={`sort-mode-option ${sortMode === 'smart' ? 'selected' : ''}`}>
                                            <input
                                                type="radio"
                                                name="sortMode"
                                                value="smart"
                                                checked={sortMode === 'smart'}
                                                onChange={() => setSortMode('smart')}
                                            />
                                            <span className="sort-mode-icon">✨</span>
                                            <span className="sort-mode-text">
                                                <span className="sort-mode-title">スマートソート</span>
                                                <span className="sort-mode-desc">テンポ・エナジーでスムーズに</span>
                                            </span>
                                        </label>
                                    </div>
                                </div>

                                {error && (
                                    <div className="form-error">{error}</div>
                                )}

                                <button
                                    className="btn btn-primary btn-lg"
                                    onClick={handleGenerate}
                                    disabled={!canGenerate || isGenerating}
                                >
                                    {isGenerating ? (
                                        <>
                                            <div className="button-spinner"></div>
                                            {isRegenerate ? '再生成中...' : '生成中...'}
                                        </>
                                    ) : (
                                        <>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                {isRegenerate ? (
                                                    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                                ) : (
                                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                                )}
                                            </svg>
                                            {isRegenerate ? 'プレイリストを再生成' : 'プレイリストを生成'}
                                        </>
                                    )}
                                </button>
                            </div>
                        </section>
                    )}

                    {/* Auto update section */}
                    <section className="detail-section">
                        <h2 className="section-title">
                            <span className="section-icon">🗓️</span>
                            自動更新
                        </h2>
                        <div className="auto-update-card card">
                            {isOwner ? (
                                <>
                                    <label className="auto-update-toggle">
                                        <input
                                            type="checkbox"
                                            role="switch"
                                            checked={playlist.autoUpdateEnabled}
                                            disabled={playlist.status !== 'generated' || isUpdatingAutoUpdate}
                                            onChange={(event) => handleAutoUpdate(event.target.checked, playlist.autoUpdateSortMode)}
                                        />
                                        <span className="auto-update-toggle-track" aria-hidden="true">
                                            <span className="auto-update-toggle-thumb"></span>
                                        </span>
                                        <span>毎日自動で再生成する</span>
                                    </label>

                                    {playlist.status !== 'generated' && (
                                        <p className="auto-update-hint">まず一度生成してください</p>
                                    )}

                                    <div className="sort-mode-selector">
                                        <label className="sort-mode-label">自動更新時の曲の並び順:</label>
                                        <div className="sort-mode-options">
                                            <label className={`sort-mode-option ${playlist.autoUpdateSortMode === 'shuffle' ? 'selected' : ''}`}>
                                                <input
                                                    type="radio"
                                                    name="autoUpdateSortMode"
                                                    value="shuffle"
                                                    checked={playlist.autoUpdateSortMode === 'shuffle'}
                                                    disabled={playlist.status !== 'generated' || isUpdatingAutoUpdate}
                                                    onChange={() => handleAutoUpdate(playlist.autoUpdateEnabled, 'shuffle')}
                                                />
                                                <span className="sort-mode-icon">🎲</span>
                                                <span className="sort-mode-text">
                                                    <span className="sort-mode-title">シャッフル</span>
                                                    <span className="sort-mode-desc">ランダムに並べる</span>
                                                </span>
                                            </label>
                                            <label className={`sort-mode-option ${playlist.autoUpdateSortMode === 'smart' ? 'selected' : ''}`}>
                                                <input
                                                    type="radio"
                                                    name="autoUpdateSortMode"
                                                    value="smart"
                                                    checked={playlist.autoUpdateSortMode === 'smart'}
                                                    disabled={playlist.status !== 'generated' || isUpdatingAutoUpdate}
                                                    onChange={() => handleAutoUpdate(playlist.autoUpdateEnabled, 'smart')}
                                                />
                                                <span className="sort-mode-icon">✨</span>
                                                <span className="sort-mode-text">
                                                    <span className="sort-mode-title">スマートソート</span>
                                                    <span className="sort-mode-desc">テンポ・エナジーでスムーズに</span>
                                                </span>
                                            </label>
                                        </div>
                                    </div>

                                    {autoUpdateError && (
                                        <div className="form-error">{autoUpdateError}</div>
                                    )}
                                </>
                            ) : (
                                <p className="auto-update-readonly">
                                    自動更新は{playlist.autoUpdateEnabled ? '有効' : '無効'}です
                                    （並び順: {playlist.autoUpdateSortMode === 'smart' ? 'スマートソート' : 'シャッフル'}）
                                </p>
                            )}

                            {playlist.lastAutoUpdatedAt && formatAutoUpdateTime(playlist.lastAutoUpdatedAt) && (
                                <p className="auto-update-status">
                                    最終自動更新: {formatAutoUpdateTime(playlist.lastAutoUpdatedAt)}
                                </p>
                            )}
                            {playlist.lastAutoUpdateStatus === 'failed' && (
                                <p className="auto-update-warning">直近の自動更新に失敗しました</p>
                            )}
                        </div>
                    </section>

                    {/* Already generated - Spotify link */}
                    {playlist.status === 'generated' && playlist.spotifyPlaylistId && !generateResult && (
                        <section className="detail-section">
                            <div className="generated-card card">
                                <div className="generated-icon">✅</div>
                                <h3>プレイリストはSpotifyで利用できます</h3>
                                <a
                                    href={`https://open.spotify.com/playlist/${playlist.spotifyPlaylistId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-primary"
                                >
                                    Spotifyで開く
                                </a>
                            </div>
                        </section>
                    )}

                    {/* Delete section - Owner only */}
                    {isOwner && (
                        <section className="detail-section">
                            <div className="card">
                                <h3 className="section-title">危険ゾーン</h3>
                                {!showDeleteConfirm ? (
                                    <button
                                        className="btn btn-danger"
                                        onClick={() => setShowDeleteConfirm(true)}
                                    >
                                        プレイリストを削除
                                    </button>
                                ) : (
                                    <div className="delete-confirm">
                                        <p className="text-muted">本当に削除しますか？この操作は取り消せません。</p>
                                        <div className="delete-actions">
                                            <button
                                                className="btn btn-secondary"
                                                onClick={() => setShowDeleteConfirm(false)}
                                                disabled={isDeleting}
                                            >
                                                キャンセル
                                            </button>
                                            <button
                                                className="btn btn-danger"
                                                onClick={() => handleDelete(false)}
                                                disabled={isDeleting}
                                            >
                                                {isDeleting ? '削除中...' : 'アプリから削除'}
                                            </button>
                                            {playlist.spotifyPlaylistId && (
                                                <button
                                                    className="btn btn-danger"
                                                    onClick={() => handleDelete(true)}
                                                    disabled={isDeleting}
                                                >
                                                    {isDeleting ? '削除中...' : 'Spotifyからも削除'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
}
