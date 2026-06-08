import type { ReactNode } from "react";
import { Toaster, toast } from "sonner";

// Same API as before (useToast()(msg, tone) + <ToastProvider>), backed by sonner.
type Tone = "ok" | "error" | "info";

export function useToast() {
  return (msg: string, tone: Tone = "info") => {
    if (tone === "ok") toast.success(msg);
    else if (tone === "error") toast.error(msg);
    else toast(msg);
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster theme="dark" position="bottom-right" richColors closeButton
        toastOptions={{ style: { background: "var(--color-elevated2)", border: "1px solid var(--color-border)", color: "var(--color-ink)" } }} />
    </>
  );
}
