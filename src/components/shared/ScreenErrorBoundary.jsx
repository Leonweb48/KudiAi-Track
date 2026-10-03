import { Component } from "react";

// Keeps one screen's crash inside that screen. Without it a render/effect error anywhere under an overlay (e.g. the
// client Statements screen) unmounts the whole app and leaves a blank white page with no way back.
export default class ScreenErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[screen] crashed:", error?.message || error, info?.componentStack?.slice(0, 400));
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center text-center px-6 py-16">
        <p className="text-[15px] font-extrabold text-slate-800 dark:text-slate-100">This screen couldn't load</p>
        <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">Nothing was changed. Go back and try again.</p>
        <button
          onClick={() => { this.setState({ error: null }); this.props.onBack?.(); }}
          className="mt-5 px-5 py-2.5 rounded-xl bg-brand-600 text-white text-[13px] font-bold active:scale-95 transition">
          Go back
        </button>
      </div>
    );
  }
}
