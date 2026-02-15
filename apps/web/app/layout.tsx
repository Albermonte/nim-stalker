import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'NIM Stalker',
  description: 'Making blockchain gossip visual',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-display">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#FF69B4',
              color: '#FFFFFF',
              border: '3px solid #000000',
              borderRadius: '1rem',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              boxShadow: '4px 4px 0 0 #000000',
            },
          }}
        />
      </body>
    </html>
  );
}
