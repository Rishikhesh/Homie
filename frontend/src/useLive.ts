import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

/** Polls `fetcher` every `ms` while the screen is focused and the app is in the foreground. */
export function useLive<T>(fetcher: () => Promise<T>, ms = 3000, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fref = useRef(fetcher);
  fref.current = fetcher;
  const load = useCallback(async () => {
    try {
      const d = await fref.current();
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message || "No internet. Tap to try again");
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
      if (!ms) return;
      const id = setInterval(() => { if (AppState.currentState === "active") load(); }, ms);
      return () => clearInterval(id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, ms, ...deps]),
  );
  useEffect(() => { setLoading(true); load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload: load, setData };
}
