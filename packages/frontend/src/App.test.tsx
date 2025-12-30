import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';


// Simple component for testing setup
function TestComponent({ message }: { message: string }) {
    return <div>{message}</div>;
}

describe('Frontend Test Setup', () => {
    it('should render component correctly', () => {
        render(<TestComponent message="Hello Vitest" />);
        expect(screen.getByText('Hello Vitest')).toBeInTheDocument();
    });
});
