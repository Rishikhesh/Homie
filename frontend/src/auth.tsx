import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { api, loadToken, saveToken, session } from "@/src/api";
import { storage } from "@/src/utils/storage";

WebBrowser.maybeCompleteAuthSession();

export type Me = { user: any; acting: boolean; real_user?: any; unit?: any; handyman?: any; invites?: any[]; demo: boolean };
type Ctx = {
  me: Me | null; loading: boolean; signingIn: boolean; error: string | null;
  signIn: () => Promise<void>; signOut: () => Promise<void>; refresh: () => Promise<void>; actAs: (id: string | null) => Promise<void>;
};
const AuthCtx = createContext<Ctx>({} as Ctx);
export const useAuth = () => useContext(AuthCtx);
const ACT_KEY = "rw_act_as";

function extractSessionId(url?: string | null) {
  const m = (url || "").match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const used = useRef(new Set<string>());

  const clear = useCallback(async () => {
    await saveToken(null);
    session.setActAs(null);
    await storage.removeItem(ACT_KEY);
    setMe(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!session.token) { setMe(null); return; }
    try {
      const m = await api<Me>("/auth/me");
      session.setMedia((m as any).media_token);
      setMe(m);
    } catch (e: any) {
      if (e.status === 401) await clear();
      else if (e.status === 403 && session.actAs) { session.setActAs(null); await storage.removeItem(ACT_KEY); const m = await api<Me>("/auth/me"); session.setMedia((m as any).media_token); setMe(m); }
    }
  }, [clear]);

  const exchange = useCallback(async (sid: string) => {
    if (used.current.has(sid)) return;
    used.current.add(sid);
    setSigningIn(true);
    try {
      const r = await api<{ session_token: string }>("/auth/session", { body: { session_id: sid } });
      await saveToken(r.session_token);
      if (Platform.OS === "web") {
        const u = new URL(window.location.href);
        u.hash = u.hash.replace(/session_id=[^&]+&?/, "").replace(/^#$/, "");
        u.searchParams.delete("session_id");
        window.history.replaceState(window.history.state, "", u.toString());
      }
      await refresh();
    } catch (e: any) {
      setError(e.message || "Sign-in didn't finish. Please try again");
    } finally {
      setSigningIn(false);
    }
  }, [refresh]);

  useEffect(() => {
    session.onUnauthorized(() => { clear(); });
    (async () => {
      let sid: string | null = null;
      if (Platform.OS === "web") sid = extractSessionId(window.location.href);
      else sid = extractSessionId(await Linking.getInitialURL());
      if (sid) await exchange(sid);
      else {
        const t = await loadToken();
        session.setToken(t);
        const a = (await storage.getItem(ACT_KEY, null)) as string | null;
        session.setActAs(a);
        await refresh();
      }
      setLoading(false);
    })();
    if (Platform.OS !== "web") {
      const sub = Linking.addEventListener("url", ({ url }) => { const s = extractSessionId(url); if (s) exchange(s); });
      return () => sub.remove();
    }
  }, [clear, exchange, refresh]);

  const signIn = useCallback(async () => {
    setError(null);
    if (Platform.OS === "web") {
      const redirect = window.location.origin + "/";
      window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      return;
    }
    const redirect = Linking.createURL("");
    let captured: string | null = null;
    const sub = Linking.addEventListener("url", ({ url }) => { captured = url; });
    try {
      const res = await WebBrowser.openAuthSessionAsync(`https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`, redirect);
      const url = (res as any).url || captured || (await Linking.getInitialURL());
      const sid = extractSessionId(url);
      if (sid) await exchange(sid);
    } finally {
      sub.remove();
    }
  }, [exchange]);

  const signOut = useCallback(async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    await clear();
  }, [clear]);

  const actAs = useCallback(async (id: string | null) => {
    session.setActAs(id);
    if (id) await storage.setItem(ACT_KEY, id); else await storage.removeItem(ACT_KEY);
    await refresh();
  }, [refresh]);

  return <AuthCtx.Provider value={{ me, loading, signingIn, error, signIn, signOut, refresh, actAs }}>{children}</AuthCtx.Provider>;
}
