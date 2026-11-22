/** Ponte de arquivos: informações de caminhos, clipboard (somente arquivos copiados) e abrir no Explorer. */
import { invoke } from "@tauri-apps/api/core";

export interface ArquivoInfo {
  nome: string;
  caminho: string;
  tamanho: number;
  pasta: boolean;
}

export const infoArquivos = (caminhos: string[]) =>
  invoke<ArquivoInfo[]>("info_arquivos", { caminhos });

export const revelarArquivo = (caminho: string) =>
  invoke("revelar_arquivo", { caminho }).catch((e) => console.error("Revelar arquivo:", e));

export interface ClipboardArquivos { seq: number; caminhos: string[] }

/** Devolve algo só quando o clipboard mudou desde `ultimaSeq`. */
export const clipboardArquivos = (ultimaSeq: number) =>
  invoke<ClipboardArquivos | null>("clipboard_arquivos", { ultimaSeq });

export function formatarTamanho(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
