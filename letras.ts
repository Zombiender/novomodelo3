/**
 * Letras sincronizadas (LRC) via LRCLIB — gratuito e sem chave.
 * Se a faixa só tiver letra "solta" (sem tempos), devolvemos sem sincronia.
 */
import { fetch } from "@tauri-apps/plugin-http";

export interface LinhaLetra { t: number; texto: string }
export interface Letra { linhas: LinhaLetra[]; sincronizada: boolean }

const cache = new Map<string, Letra | null>();

export function parsearLrc(lrc: string): LinhaLetra[] {
  const linhas: LinhaLetra[] = [];
  for (const bruta of lrc.split(/\r?\n/)) {
    const tempos = [...bruta.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tempos.length) continue;
    const texto = bruta.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of tempos) {
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0").slice(0, 3), 10) / 1000 : 0;
      linhas.push({ t: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac, texto });
    }
  }
  return linhas.sort((a, b) => a.t - b.t);
}

export async function buscarLetra(titulo: string, artista: string, duracaoS: number): Promise<Letra | null> {
  const chave = `${artista}|${titulo}`.toLowerCase();
  if (cache.has(chave)) return cache.get(chave) ?? null;
  let resultado: Letra | null = null;
  try {
    const q = new URLSearchParams({ track_name: titulo, artist_name: artista });
    if (duracaoS > 0) q.set("duration", String(Math.round(duracaoS)));
    let r = await fetch(`https://lrclib.net/api/get?${q}`);
    let j: any = r.ok ? await r.json() : null;
    if (!j) { // busca mais tolerante quando a faixa exata não existe
      r = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: titulo, artist_name: artista })}`);
      const lista: any[] = r.ok ? await r.json() : [];
      j = lista.find((x) => x.syncedLyrics) ?? lista[0] ?? null;
    }
    if (j?.syncedLyrics) {
      const linhas = parsearLrc(j.syncedLyrics);
      if (linhas.length) resultado = { linhas, sincronizada: true };
    }
    if (!resultado && j?.plainLyrics) {
      const linhas = String(j.plainLyrics).split(/\r?\n/).map((texto, i) => ({ t: i, texto: texto.trim() })).filter((l) => l.texto);
      if (linhas.length) resultado = { linhas, sincronizada: false };
    }
  } catch (e) {
    console.warn("Letra indisponível:", e);
  }
  cache.set(chave, resultado);
  return resultado;
}
