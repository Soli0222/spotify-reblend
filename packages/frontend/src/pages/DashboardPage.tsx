import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { playlistApi, invitationApi, Playlist, Invitation } from '../services/api';
import './DashboardPage.css';

export default function DashboardPage() {
    const { user, logout } = useAuth();
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [processingInvitation, setProcessingInvitation] = useState<number | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [playlistsRes, invitationsRes] = await Promise.all([
                playlistApi.list(),
                invitationApi.list(),
            ]);
            setPlaylists(playlistsRes.data);
            setInvitations(invitationsRes.data.filter(i => i.status === 'pending'));
        } catch (error) {
            console.error('Failed to load data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAcceptInvitation = async (invitationId: number) => {
        setProcessingInvitation(invitationId);
        try {
            await invitationApi.accept(invitationId);
            await loadData();
        } catch (error) {
            console.error('Failed to accept invitation:', error);
        } finally {
            setProcessingInvitation(null);
        }
    };

    const handleDeclineInvitation = async (invitationId: number) => {
        setProcessingInvitation(invitationId);
        try {
            await invitationApi.decline(invitationId);
            setInvitations(invitations.filter(i => i.id !== invitationId));
        } catch (error) {
            console.error('Failed to decline invitation:', error);
        } finally {
            setProcessingInvitation(null);
        }
    };

    if (isLoading) {
        return (
            <div className="dashboard-loading">
                <div className="spinner"></div>
            </div>
        );
    }

    return (
        <div className="dashboard">
            <header className="dashboard-header">
                <div className="container">
                    <div className="header-content">
                        <div className="header-logo">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" className="logo-icon-small">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 14.36c-.18.27-.52.36-.79.18-2.19-1.34-4.94-1.64-8.18-.9-.31.07-.62-.12-.69-.43-.07-.31.12-.62.43-.69 3.54-.81 6.58-.46 9.05 1.05.27.18.36.52.18.79zm1.22-2.71c-.22.34-.68.44-1.02.22-2.5-1.54-6.32-1.98-9.28-1.08-.38.12-.78-.09-.9-.47-.12-.38.09-.78.47-.9 3.38-1.03 7.58-.53 10.51 1.23.34.22.44.68.22 1.02zm.1-2.82c-3-1.78-7.95-1.95-10.82-1.08-.46.14-.95-.12-1.09-.58-.14-.46.12-.95.58-1.09 3.3-1 8.77-.81 12.23 1.24.42.25.56.79.31 1.21-.25.42-.79.56-1.21.31z" />
                            </svg>
                            <span className="header-title">ReBlend</span>
                        </div>
                        <div className="header-user">
                            <span className="user-name">{user?.displayName}</span>
                            <button className="btn btn-ghost btn-sm" onClick={logout}>
                                ログアウト
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="dashboard-main">
                <div className="container">
                    {/* Pending Invitations */}
                    {invitations.length > 0 && (
                        <section className="dashboard-section animate-slideUp">
                            <h2 className="section-title">
                                <span className="section-icon">📩</span>
                                招待 ({invitations.length})
                            </h2>
                            <div className="invitation-list">
                                {invitations.map((invitation) => (
                                    <div key={invitation.id} className="invitation-card card">
                                        <div className="invitation-info">
                                            <h3 className="invitation-playlist">{invitation.playlistName}</h3>
                                            <p className="invitation-inviter">
                                                {invitation.inviterName} さんからの招待
                                            </p>
                                        </div>
                                        <div className="invitation-actions">
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={() => handleAcceptInvitation(invitation.id)}
                                                disabled={processingInvitation === invitation.id}
                                            >
                                                承諾
                                            </button>
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => handleDeclineInvitation(invitation.id)}
                                                disabled={processingInvitation === invitation.id}
                                            >
                                                辞退
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* My Playlists */}
                    <section className="dashboard-section animate-slideUp" style={{ animationDelay: '0.1s' }}>
                        <div className="section-header">
                            <h2 className="section-title">
                                <span className="section-icon">🎵</span>
                                マイプレイリスト
                            </h2>
                            <Link to="/playlists/new" className="btn btn-primary">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                                新規作成
                            </Link>
                        </div>

                        {playlists.length === 0 ? (
                            <div className="empty-state card">
                                <div className="empty-icon">🎶</div>
                                <h3>プレイリストがありません</h3>
                                <p className="text-secondary">
                                    最初のReBlendプレイリストを作成して、友達を招待しましょう！
                                </p>
                                <Link to="/playlists/new" className="btn btn-primary">
                                    プレイリストを作成
                                </Link>
                            </div>
                        ) : (
                            <div className="playlist-grid">
                                {playlists.map((playlist) => (
                                    <Link
                                        key={playlist.id}
                                        to={`/playlists/${playlist.id}`}
                                        className="playlist-card card"
                                    >
                                        <div className="playlist-card-header">
                                            <h3 className="playlist-name">{playlist.name}</h3>
                                            <span className={`badge badge-${playlist.role}`}>
                                                {playlist.role === 'owner' ? 'オーナー' : 'メンバー'}
                                            </span>
                                        </div>
                                        {playlist.description && (
                                            <p className="playlist-description">{playlist.description}</p>
                                        )}
                                        <div className="playlist-meta">
                                            <span className={`badge badge-${playlist.status === 'generated' ? 'success' : 'pending'}`}>
                                                {playlist.status === 'generated' ? '生成済み' : '準備中'}
                                            </span>
                                            {playlist.role !== 'owner' && (
                                                <span className="text-muted">by {playlist.ownerName}</span>
                                            )}
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </main>
        </div>
    );
}
