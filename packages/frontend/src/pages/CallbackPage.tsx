import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function CallbackPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { handleCallback } = useAuth();
    const [error, setError] = useState<string | null>(null);
    // Prevent double execution in React StrictMode
    const hasCalledRef = useRef(false);

    useEffect(() => {
        // Guard against double execution
        if (hasCalledRef.current) return;

        const code = searchParams.get('code');
        const errorParam = searchParams.get('error');

        if (errorParam) {
            setError('ログインがキャンセルされました');
            return;
        }

        if (code) {
            hasCalledRef.current = true;
            handleCallback(code)
                .then(() => {
                    navigate('/dashboard', { replace: true });
                })
                .catch(() => {
                    hasCalledRef.current = false; // Allow retry on error
                    setError('認証に失敗しました。もう一度お試しください。');
                });
        } else {
            setError('認証コードが見つかりません');
        }
    }, [searchParams, handleCallback, navigate]);

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center" style={{ minHeight: '100vh' }}>
                <p style={{ color: 'var(--color-error)', marginBottom: 'var(--spacing-lg)' }}>{error}</p>
                <button className="btn btn-primary" onClick={() => navigate('/')}>
                    ログインページに戻る
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center" style={{ minHeight: '100vh' }}>
            <div className="spinner" style={{ marginBottom: 'var(--spacing-lg)' }}></div>
            <p className="text-secondary">ログイン中...</p>
        </div>
    );
}
