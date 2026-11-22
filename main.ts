/** Ponto de entrada: nome (tela de boas-vindas), janela overlay, ponte com o HTML e assistente. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { ALTURA_JANELA, LARGURA_JANELA } from "./core/config";
import { iniciarAtalho } from "./core/atalho";
import { ESTADO } from "./core/estado";
import { Assistente } from "./core/orquestrador";
import { iniciarOverlay } from "./core/overlay";
import { iniciarMidia } from "./core/midia";
import { montarUI } from "./ui/montar";

declare global {
  interface Window {
    /** Ponte para o index.html (estado, comandos e notificações). */
    aura: {
      estado: (desdeNotif: number, desdeMsg: number) => ReturnType<typeof ESTADO.instantaneo>;
      comando: (texto: string) => void;
      assinar: (fn: () => void) => () => void;
      /** Mostra um pedido de aprovação na ilha; resolve true (aceito) ou false (negado). */
      pedirAprovacao: (app: string, mensagem: string) => Promise<boolean>;
    };
  }
}

/**
 * Nome: variável de ambiente → nome já salvo → tela de boas-vindas (welcome.html).
 * Na primeira vez a ilha fica escondida; a tela de boas-vindas minimiza depois da escolha
 * e então a ilha aparece.
 */
async function obterNomeAssistente(): Promise<string> {
  const env = (import.meta.env.VITE_NOME_ASSISTENTE as string | undefined)?.trim();
  if (env) return env;
  const salvo = await invoke<string | null>("ler_nome").catch(() => null);
  if (salvo) return salvo;

  const janela = getCurrentWindow();
  await janela.hide();

  const nome = await new Promise<string>((resolve) => {
    void listen<string>("nome-definido", (e) => resolve(String(e.payload ?? "").trim() || "Aura"));
    const boasVindas = new WebviewWindow("boas-vindas", {
      url: "welcome.html",
      title: "Aura",
      width: 760,
      height: 600,
      center: true,
      resizable: false,
    });
    // Se a janela de boas-vindas for fechada sem escolher o nome, usa o padrão
    boasVindas.once("tauri://destroyed", () => resolve("Aura"));
    boasVindas.once("tauri://error", () => resolve("Aura"));
  });

  await invoke("salvar_nome", { nome }).catch((e) => console.error("Não salvou o nome:", e));
  await janela.show();
  return nome;
}

/** Centraliza a janela no topo do monitor principal. */
async function posicionarJanela(): Promise<void> {
  const janela = getCurrentWindow();
  const monitor = await currentMonitor();
  if (!monitor) return;
  const x = monitor.position.x + Math.max(0, Math.round((monitor.size.width - LARGURA_JANELA * monitor.scaleFactor) / 2));
  await janela.setPosition(new PhysicalPosition(x, monitor.position.y));
}

async function principal(): Promise<void> {
  montarUI(); // a interface sobe primeiro; ela se liga ao assistente por ESTADO e window.aura
  await posicionarJanela();
  const nome = await obterNomeAssistente();
  ESTADO.atualizar({ nome, visivel: true });
  const assistente = new Assistente(nome);
  document.title = nome;
  await getCurrentWindow().setTitle(nome);

  window.aura = {
    estado: (n, m) => ESTADO.instantaneo(n, m),
    comando: (texto) => {
      const t = String(texto).trim().slice(0, 500);
      if (!t) return;
      ESTADO.adicionarMensagem("user", t);
      void assistente.processarComando(t).catch((e) => console.error("Erro ao processar comando da interface:", e));
    },
    assinar: (fn) => ESTADO.assinar(fn),
    pedirAprovacao: (app, mensagem) => ESTADO.pedirAprovacao(app, mensagem),
  };
  document.dispatchEvent(new CustomEvent("aura-pronta"));

  iniciarOverlay("dynamicIsland");
  iniciarMidia();
  iniciarAtalho();
  await assistente.executar();
}

void principal();
void ALTURA_JANELA;
