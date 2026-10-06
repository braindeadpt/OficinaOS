import { Toaster } from "sonner";

/**
 * Toasts on the inverse surface (design-system.md §4.8): dark in light mode,
 * light in dark mode, bottom-right on desktop and bottom-centre on mobile.
 * Colours come from the inverse tokens in app.css, so the theme prop stays
 * fixed and the toast flips with the rest of the app.
 */
export function AppToaster() {
  return (
    <Toaster
      closeButton
      duration={5000}
      mobileOffset={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
      position="bottom-right"
      theme="light"
      toastOptions={{
        classNames: {
          toast: "oos-toast",
        },
      }}
      visibleToasts={3}
    />
  );
}
