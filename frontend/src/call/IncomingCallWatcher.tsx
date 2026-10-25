// Handyman only: poll for a ringing call every 3 s while the app is open and open the full-screen call.
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { api } from "@/src/api";

export function IncomingCallWatcher() {
  const router = useRouter();
  const path = usePathname();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!alive || AppState.currentState !== "active" || path.startsWith("/call/")) return;
      try {
        const r = await api("/calls/incoming");
        if (r?.call && shown.current !== r.call.id) { shown.current = r.call.id; router.push(`/call/${r.call.id}`); }
      } catch {}
    };
    check();
    const id = setInterval(check, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [router, path]);
  return null;
}
