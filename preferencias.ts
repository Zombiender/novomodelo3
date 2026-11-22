/**
 * Preferências do usuário salvas no próprio app (localStorage do webview).
 * Têm prioridade sobre as variáveis VITE_* do .env, que ficam só como valor inicial.
 */
const env = import.meta.env as Record<string, string | undefined>;

export type FormatoIlha = "notch" | "pupila";

const CHAVES = {
  gemini: "aura_gemini_key",
  spotifyClientId: "aura_spotify_client_id",
  spotifyRefresh: "aura_spotify_refresh",
  formato: "aura_formato_ilha",
} as const;

function ler(chave: string): string {
  try { return localStorage.getItem(chave) ?? ""; } catch { return ""; }
}
function gravar(chave: string, valor: string): void {
  try {
    if (valor) localStorage.setItem(chave, valor); else localStorage.removeItem(chave);
  } catch (e) { console.error("Não consegui salvar a preferência:", e); }
}

export const PREFS = {
  chaveGemini: () => ler(CHAVES.gemini) || (env.VITE_GEMINI_API_KEY ?? ""),
  definirChaveGemini: (v: string) => gravar(CHAVES.gemini, v.trim()),

  spotifyClientId: () => ler(CHAVES.spotifyClientId) || (env.VITE_SPOTIFY_CLIENT_ID ?? ""),
  spotifyRefreshToken: () => ler(CHAVES.spotifyRefresh) || (env.VITE_SPOTIFY_REFRESH_TOKEN ?? ""),
  definirSpotify: (clientId: string, refreshToken: string) => {
    gravar(CHAVES.spotifyClientId, clientId.trim());
    gravar(CHAVES.spotifyRefresh, refreshToken.trim());
  },
  desvincularSpotify: () => { gravar(CHAVES.spotifyClientId, ""); gravar(CHAVES.spotifyRefresh, ""); },

  formato: (): FormatoIlha => (ler(CHAVES.formato) === "pupila" ? "pupila" : "notch"),
  definirFormato: (f: FormatoIlha) => gravar(CHAVES.formato, f),
};
