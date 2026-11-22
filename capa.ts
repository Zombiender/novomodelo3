/** Capa do álbum via iTunes Search (sem chave). Devolve a URL da imagem ou null. */
import { fetch } from "@tauri-apps/plugin-http";

const cache = new Map<string, string | null>();

export async function buscarCapa(titulo: string, artista: string): Promise<string | null> {
  const chave = `${artista}|${titulo}`.toLowerCase();
  if (cache.has(chave)) return cache.get(chave) ?? null;
  let url: string | null = null;
  try {
    const r = await fetch(`https://itunes.apple.com/search?${new URLSearchParams({ term: `${artista} ${titulo}`, entity: "song", limit: "1" })}`);
    if (r.ok) {
      const j: any = await r.json();
      const arte: string | undefined = j?.results?.[0]?.artworkUrl100;
      if (arte) url = arte.replace("100x100", "300x300");
    }
  } catch (e) {
    console.warn("Capa indisponível:", e);
  }
  cache.set(chave, url);
  return url;
}
