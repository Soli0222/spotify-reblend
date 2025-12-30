import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi } from '../services/api';

interface User {
    id: number;
    spotifyId: string;
    displayName: string;
    email: string;
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: () => Promise<void>;
    logout: () => void;
    handleCallback: (code: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        checkAuth();
    }, []);

    const checkAuth = async () => {
        const userId = localStorage.getItem('userId');
        if (!userId) {
            setIsLoading(false);
            return;
        }

        try {
            const response = await authApi.getMe();
            setUser(response.data);
        } catch {
            localStorage.removeItem('userId');
            localStorage.removeItem('accessToken');
        } finally {
            setIsLoading(false);
        }
    };

    const login = async () => {
        try {
            const response = await authApi.getLoginUrl();
            window.location.href = response.data.url;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    };

    const handleCallback = async (code: string) => {
        try {
            const response = await authApi.callback(code);
            localStorage.setItem('userId', response.data.user.id.toString());
            localStorage.setItem('accessToken', response.data.accessToken);
            setUser(response.data.user);
        } catch (error) {
            console.error('Callback error:', error);
            throw error;
        }
    };

    const logout = () => {
        localStorage.removeItem('userId');
        localStorage.removeItem('accessToken');
        setUser(null);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                isLoading,
                isAuthenticated: !!user,
                login,
                logout,
                handleCallback,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
