import { Component, type ReactNode } from "react";
import i18n from "@/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// biome-ignore lint/style/useReactFunctionComponents: React error boundaries require class components
export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="m-4 rounded-xl bg-error-container p-6 text-center">
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-3xl text-on-error-container"
          >
            cloud_off
          </span>
          <p className="mt-2 font-bold font-headline text-on-error-container">
            {i18n.t("errors.unexpected_title")}
          </p>
          <p className="mt-1 text-on-error-container/70 text-sm">
            {i18n.t("errors.unexpected_body")}
          </p>
          <button
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 font-bold font-headline text-on-primary transition-colors hover:bg-primary-container"
            onClick={() => window.location.reload()}
            type="button"
          >
            {i18n.t("errors.unexpected_reload")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
