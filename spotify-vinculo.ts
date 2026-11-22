/**
 * Vinculação do Spotify dentro do app (Authorization Code + PKCE, sem servidor externo).
 * 1) abre o navegador na página de login do Spotify;
 * 2) o Rust escuta em 127.0.0.1 só para receber o "code";
 * 3) troca o code pelo refresh token e salva em PREFS.
 * No painel do Spotify (developer.spotify.com) cadastre exatamente esta Redirect URI:
 *   http://127.0.0.1:8898/callback
 */
import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import { PREFS } from "./preferencias";

export const PORTA_CALLBACK = 8898;
export const REDIRECT_URI = `http://127.0.0.1:${PORTA_CALLBACK}/callback`;
const ESCOPOS = "user-modify-playback-state user-read-playback-state user-read-currently-playing";

function base64Url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function gerarPkce() {
  const aleatorio = crypto.getRandomValues(new Uint8Array(64));
  const verifier = base64Url(aleatorio);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(hash)) };
}

/** Faz o fluxo completo. Lança erro com mensagem amigável se algo falhar. */
export async function vincularSpotify(clientId: string): Promise<void> {
  const id = clientId.trim();
  if (!id) throw new Error("Informe o Client ID do Spotify.");
  const { verifier, challenge } = await gerarPkce();
  const url = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
    client_id: id, response_type: "code", redirect_uri: REDIRECT_URI,
    scope: ESCOPOS, code_challenge_method: "S256", code_challenge: challenge,
  });

  const esperando = invoke<string>("spotify_aguardar_codigo", { porta: PORTA_CALLBACK });
  await invoke("abrir_url", { url });
  const code = await esperando;

  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI,
      client_id: id, code_verifier: verifier,
    }).toString(),
  });
  if (!r.ok) throw new Error(`O Spotify recusou a vinculação (${r.status}). Confira o Client ID e a Redirect URI.`);
  const j: any = await r.json();
  if (!j.refresh_token) throw new Error("O Spotify não devolveu o token de acesso.");
  PREFS.definirSpotify(id, j.refresh_token);
}
