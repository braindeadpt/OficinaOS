import { useEffect, useState } from "react";
import api from "@/lib/api";
import ChatInterface from "./chat-interface";

export default function AiAnalystPage() {
  // /ai/status is permission-gated by ai:access, not settings:view — a
  // technician using the analyst must not need settings access.
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/ai/status")
      .then((res) => {
        if (!cancelled) {
          setEnabled(Boolean(res.data?.enabled));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnabled(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (enabled === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-2xl text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  return <ChatInterface agentEnabled={enabled} />;
}
