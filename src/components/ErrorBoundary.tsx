import React from 'react';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'unknown_ui_error',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('UI_RUNTIME_ERROR', { error, errorInfo });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-lg border border-red-500/40 bg-zinc-900/90 p-6 shadow-lg">
          <h1 className="text-xl font-semibold text-red-400">Arayuz Hatasi</h1>
          <p className="mt-3 text-sm text-zinc-200">
            Bir bilesen beklenmeyen bir hata olusturdu. Sayfayi yenileyip tekrar deneyin.
          </p>
          <pre className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400 whitespace-pre-wrap">
            {this.state.message}
          </pre>
        </div>
      </div>
    );
  }
}
