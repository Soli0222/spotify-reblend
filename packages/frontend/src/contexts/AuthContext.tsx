import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi, User } from '../services/api';

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: () => Promise<void>;
    logout: () => Promise<void>;
    handleCallback: (code: string, state: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        checkAuth();
    }, []);

    const checkAuth = async () => {
        try {
            const response = await authApi.getMe();
            setUser(response.data);
        } catch {
            setUser(null);
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

    const handleCallback = async (code: string, state: string) => {
        try {
            const response = await authApi.callback(code, state);
            setUser({ ...response.data.user, tokenStatus: 'active' });
        } catch (error) {
            console.error('Callback error:', error);
            throw error;
        }
    };

    const logout = async () => {
        try {
            await authApi.logout();
        } finally {
            localStorage.removeItem('userId');
            localStorage.removeItem('accessToken');
        }
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
