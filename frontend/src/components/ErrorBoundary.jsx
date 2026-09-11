import { Component } from "react";
import { AlertTriangle } from "lucide-react";

// React has no hook equivalent of componentDidCatch — this has to be a
// class. Catches a render-time exception anywhere below it and shows a
// recoverable fallback instead of letting React unmount the whole tree to
// a blank page. `App.js` keys one of these per route (see
// <RouteErrorBoundary>) so navigating away from the page that broke clears
// the error automatically; `level="app"` renders a plainer fallback for the
// outermost boundary, in case the chrome around the routes itself fails.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No error-reporting service is wired up yet — this is at least a real
    // stack trace in the Vercel function/browser console instead of silence.
    console.error("Unhandled render error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const isApp = this.props.level === "app";
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-[#121212] p-8 text-center ${isApp ? "min-h-screen" : "min-h-[50vh]"}`}
        data-testid="error-boundary"
      >
        <AlertTriangle size={28} className="text-magic" />
        <h2 className="font-display text-lg font-semibold text-white">
          {isApp ? "CreateOS hit a problem" : "Something went wrong on this page"}
        </h2>
        <p className="max-w-sm text-sm leading-relaxed text-zinc-500">
          {this.state.error?.message || "An unexpected error occurred."}
          {!isApp && " Your other pages should still work — try going back or reloading."}
        </p>
        <div className="mt-2 flex gap-2">
          {!isApp && (
            <a href="/" data-testid="error-boundary-home"
              className="rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover">
              Back to Dashboard
            </a>
          )}
          <button onClick={() => window.location.reload()} data-testid="error-boundary-reload"
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10">
            Reload
          </button>
        </div>
      </div>
    );
  }
}
