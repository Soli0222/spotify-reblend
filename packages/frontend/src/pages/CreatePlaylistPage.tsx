import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { playlistApi } from '../services/api';
import './CreatePlaylistPage.css';

export default function CreatePlaylistPage() {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim()) {
            setError('プレイリスト名を入力してください');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const response = await playlistApi.create(name.trim(), description.trim());
            navigate(`/playlists/${response.data.id}`);
        } catch (err) {
            console.error('Failed to create playlist:', err);
            setError('プレイリストの作成に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="create-playlist-page">
            <div className="container">
                <div className="create-playlist-content animate-slideUp">
                    <div className="page-header">
                        <Link to="/dashboard" className="back-link">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M19 12H5M12 19l-7-7 7-7" />
                            </svg>
                            戻る
                        </Link>
                        <h1 className="page-title">新規プレイリスト作成</h1>
                    </div>

                    <form onSubmit={handleSubmit} className="create-form card">
                        <div className="form-group">
                            <label htmlFor="name" className="form-label">プレイリスト名 *</label>
                            <input
                                type="text"
                                id="name"
                                className="input"
                                placeholder="例: 夏のドライブ mix"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                maxLength={100}
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="description" className="form-label">説明（任意）</label>
                            <textarea
                                id="description"
                                className="input textarea"
                                placeholder="プレイリストの説明を入力..."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                maxLength={300}
                                rows={3}
                            />
                        </div>

                        {error && (
                            <div className="form-error">
                                {error}
                            </div>
                        )}

                        <div className="form-actions">
                            <Link to="/dashboard" className="btn btn-ghost">
                                キャンセル
                            </Link>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={isSubmitting || !name.trim()}
                            >
                                {isSubmitting ? '作成中...' : '作成する'}
                            </button>
                        </div>
                    </form>

                    <div className="create-info">
                        <h3>💡 次のステップ</h3>
                        <ol>
                            <li>プレイリストを作成</li>
                            <li>友達を招待</li>
                            <li>全員が参加したらブレンド！</li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    );
}
