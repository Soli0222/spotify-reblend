import { useAuth } from '../contexts/AuthContext';
import './LoginPage.css';

export default function LoginPage() {
    const { login } = useAuth();

    const handleLogin = async () => {
        try {
            await login();
        } catch (error) {
            console.error('Login failed:', error);
        }
    };

    return (
        <div className="login-page">
            <div className="login-hero">
                <div className="login-content animate-slideUp">
                    <div className="login-logo">
                        <div className="logo-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 14.36c-.18.27-.52.36-.79.18-2.19-1.34-4.94-1.64-8.18-.9-.31.07-.62-.12-.69-.43-.07-.31.12-.62.43-.69 3.54-.81 6.58-.46 9.05 1.05.27.18.36.52.18.79zm1.22-2.71c-.22.34-.68.44-1.02.22-2.5-1.54-6.32-1.98-9.28-1.08-.38.12-.78-.09-.9-.47-.12-.38.09-.78.47-.9 3.38-1.03 7.58-.53 10.51 1.23.34.22.44.68.22 1.02zm.1-2.82c-3-1.78-7.95-1.95-10.82-1.08-.46.14-.95-.12-1.09-.58-.14-.46.12-.95.58-1.09 3.3-1 8.77-.81 12.23 1.24.42.25.56.79.31 1.21-.25.42-.79.56-1.21.31z" />
                            </svg>
                        </div>
                        <h1 className="login-title">ReBlend</h1>
                    </div>

                    <p className="login-description">
                        友達と一緒に、あなたたちだけの
                        <br />
                        <span className="highlight">共有プレイリスト</span>を作ろう
                    </p>

                    <div className="login-features">
                        <div className="feature">
                            <span className="feature-icon">🎵</span>
                            <span>お互いのトップ曲をブレンド</span>
                        </div>
                        <div className="feature">
                            <span className="feature-icon">👥</span>
                            <span>友達を招待してコラボ</span>
                        </div>
                        <div className="feature">
                            <span className="feature-icon">💚</span>
                            <span>Spotifyに自動保存</span>
                        </div>
                    </div>

                    <button className="btn btn-primary btn-lg login-btn" onClick={handleLogin}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 14.36c-.18.27-.52.36-.79.18-2.19-1.34-4.94-1.64-8.18-.9-.31.07-.62-.12-.69-.43-.07-.31.12-.62.43-.69 3.54-.81 6.58-.46 9.05 1.05.27.18.36.52.18.79zm1.22-2.71c-.22.34-.68.44-1.02.22-2.5-1.54-6.32-1.98-9.28-1.08-.38.12-.78-.09-.9-.47-.12-.38.09-.78.47-.9 3.38-1.03 7.58-.53 10.51 1.23.34.22.44.68.22 1.02zm.1-2.82c-3-1.78-7.95-1.95-10.82-1.08-.46.14-.95-.12-1.09-.58-.14-.46.12-.95.58-1.09 3.3-1 8.77-.81 12.23 1.24.42.25.56.79.31 1.21-.25.42-.79.56-1.21.31z" />
                        </svg>
                        Spotifyでログイン
                    </button>
                </div>

                <div className="login-visual">
                    <div className="visual-ring ring-1"></div>
                    <div className="visual-ring ring-2"></div>
                    <div className="visual-ring ring-3"></div>
                </div>
            </div>
        </div>
    );
}
