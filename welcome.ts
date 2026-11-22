/** Tela de boas-vindas (welcome.html): salva o nome, avisa o app principal e minimiza a janela. */
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

declare global {
  interface Window {
    __aoConfirmarNome?: (nome: string) => void;
  }
}

window.__aoConfirmarNome = (nome: string) => {
  void (async () => {
    await invoke("salvar_nome", { nome });
    await emit("nome-definido", nome);
    await getCurrentWebviewWindow().minimize();
  })().catch((e) => console.error("Erro na tela de boas-vindas:", e));
};
