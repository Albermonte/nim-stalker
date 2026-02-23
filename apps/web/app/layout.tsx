import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'NIM Stalker',
  description: 'Making blockchain gossip visual',
};

const GITHUB_REPO_URL = 'https://github.com/Albermonte/nim-stalker';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-display">
        {children}
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open repository on GitHub"
          className="fixed bottom-4 right-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-sm border-2 border-nq-black bg-nq-white text-nq-black transition-all duration-200 hover:-translate-y-0.5 active:translate-x-[3px] active:translate-y-[4px] active:shadow-none"
          style={{ boxShadow: '4px 4px 0 0 #000000' }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="currentColor"
          >
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.92.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.69-1.28-1.69-1.04-.72.08-.71.08-.71 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.67 1.24 3.32.95.1-.74.4-1.24.73-1.52-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.09 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.08.78 2.18 0 1.57-.01 2.84-.01 3.23 0 .3.21.66.79.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
          </svg>
          <span className="sr-only">Open repository on GitHub</span>
        </a>
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
