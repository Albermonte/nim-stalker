'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GraphErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[GraphErrorBoundary] Caught error:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center h-full bg-nq-cream p-8">
          <div className="nq-card max-w-md text-center">
            {/* NQ-style warning icon */}
            <div className="w-16 h-16 mx-auto mb-4 rounded border-3 border-nq-black bg-nq-pink flex items-center justify-center">
              <span className="text-4xl font-bold text-nq-white">!</span>
            </div>

            <h2 className="text-xl font-bold uppercase tracking-wider mb-2 flex items-center justify-center gap-2">
              <span className="text-nq-pink">✦</span> Error <span className="text-nq-yellow">✦</span>
            </h2>
            <p className="text-sm uppercase tracking-wide mb-4 opacity-70">
              Something went wrong while rendering the graph visualization.
            </p>

            {this.state.error && (
              <details className="mb-4 text-left">
                <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider hover:bg-nq-pink hover:text-nq-white transition-colors p-2 rounded border-2 border-nq-black">
                  Error Details
                </summary>
                <pre className="mt-2 p-3 bg-nq-black text-nq-white rounded border-2 border-nq-black text-xs overflow-auto max-h-32 font-mono">
                  {this.state.error.message}
                </pre>
              </details>
            )}

            <button
              onClick={this.handleRetry}
              className="nq-btn-pink w-full"
            >
              Try Again
            </button>

            <p className="mt-4 text-xs uppercase tracking-wide opacity-60">
              If the problem persists, try refreshing the page.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
