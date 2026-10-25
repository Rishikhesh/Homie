import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";

export const API = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;
export const TOKEN_KEY = "rw_session_token";

let token: string | null = null;
let media: string | null = null;
let actAs: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const session = {
  get token() { return token; },
  get actAs() { return actAs; },
  setToken(t: string | null) { token = t; },
  setMedia(m: string | null) { media = m; },
  setActAs(a: string | null) { actAs = a; },
  onUnauthorized(fn: () => void) { onUnauthorized = fn; },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (actAs) headers["X-Act-As"] = actAs;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { method: opts.method || (opts.body ? "POST" : "GET"), headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, "No internet. Tap to try again");
  }
  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, "Please sign in again");
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(res.status, (data && data.detail) || "That didn't work. Tap to try again");
  return data as T;
}

// Links opened outside the app (images, PDFs) carry a read-only media token, never the login token.
export function fileUrl(id?: string | null) {
  if (!id) return undefined;
  return `${API}/files/${id}?media=${media}${actAs ? `&act=${actAs}` : ""}`;
}

export function authedUrl(path: string) {
  return `${API}${path}${path.includes("?") ? "&" : "?"}media=${media}${actAs ? `&act=${actAs}` : ""}`;
}

export async function saveToken(t: string | null) {
  token = t;
  if (Platform.OS === "web") {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
  } else {
    t ? await storage.secureSet(TOKEN_KEY, t) : await storage.secureRemove(TOKEN_KEY);
  }
}

export async function loadToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }
  return (await storage.secureGet(TOKEN_KEY, null)) as string | null;
}

export function money(n?: number | null) {
  const v = Number(n || 0);
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

export const PRESET_PHOTOS = [
  "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=900&q=70",
  "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=900&q=70",
  "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=900&q=70",
  "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=900&q=70",
  "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=900&q=70",
  "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=900&q=70",
];
export const HERO_PHOTO = "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=70";

export function propertyPhoto(photo?: string, id?: string) {
  if (photo?.startsWith("preset:")) return PRESET_PHOTOS[Number(photo.split(":")[1]) % PRESET_PHOTOS.length];
  if (photo) return fileUrl(photo);
  const n = (id || "x").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return PRESET_PHOTOS[n % PRESET_PHOTOS.length];
}

export function ago(isoStr: string) {
  const s = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(isoStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
