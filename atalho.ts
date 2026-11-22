/**
 * Atalho global para mostrar a ilha quando ela está escondida.
 *
 * Gravação em duas fontes, a primeira que reconhecer a combinação vale:
 *  - Rust (rdev): captura teclas do sistema inteiro, mesmo com outro app em foco;
 *  - webview: enquanto a própria ilha está em foco, lê o teclado direto (funciona mesmo
 *    se o hook global não estiver disponível).
 * A combinação aparece ao vivo nas configurações e é salva no localStorage.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const CHAVE_STORAGE = "aura_atalho";
const TEMPO_LIMITE_MS = 10000;

const ROTULOS: Record<string, string> = {
  ControlLeft: "Ctrl", ControlRight: "Ctrl", ShiftLeft: "Shift", ShiftRight: "Shift",
  Alt: "Alt", AltGr: "AltGr", MetaLeft: "Win", MetaRight: "Win",
  Space: "Espaço", Return: "Enter", Escape: "Esc", Backspace: "Backspace", Tab: "Tab",
  CapsLock: "Caps", UpArrow: "↑", DownArrow: "↓", LeftArrow: "←", RightArrow: "→",
  PageUp: "PgUp", PageDown: "PgDn",
};

/** Traduz o `code` do teclado do navegador para o nome que o Rust (rdev) usa. */
const CODIGO_PARA_TECLA: Record<string, string> = {
  AltLeft: "Alt", AltRight: "AltGr", Space: "Space", Enter: "Return", NumpadEnter: "Return",
  Escape: "Escape", Tab: "Tab", Backspace: "Backspace", CapsLock: "CapsLock",
  Insert: "Insert", Delete: "Delete", Home: "Home", End: "End",
  PageUp: "PageUp", PageDown: "PageDown",
  ArrowUp: "UpArrow", ArrowDown: "DownArrow", ArrowLeft: "LeftArrow", ArrowRight: "RightArrow",
  ControlLeft: "ControlLeft", ControlRight: "ControlRight",
  ShiftLeft: "ShiftLeft", ShiftRight: "ShiftRight",
  MetaLeft: "MetaLeft", MetaRight: "MetaRight",
};

function nomeDoCodigo(codigo: string): string | null {
  if (CODIGO_PARA_TECLA[codigo]) return CODIGO_PARA_TECLA[codigo];
  if (/^Key[A-Z]$/.test(codigo)) return codigo;
  if (/^Digit[0-9]$/.test(codigo)) return "Num" + codigo.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(codigo)) return codigo;
  return null;
}

export function rotuloTecla(nome: string): string {
  if (ROTULOS[nome]) return ROTULOS[nome];
  if (/^Key[A-Z]$/.test(nome)) return nome.slice(3);
  if (/^Num\d$/.test(nome)) return nome.slice(3);
  return nome;
}

export function rotuloAtalho(teclas: string[]): string {
  return teclas.length ? teclas.map(rotuloTecla).join(" + ") : "Nenhum";
}

function carregarSalvo(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_STORAGE) ?? "[]");
  } catch {
    return [];
  }
}

declare global {
  interface Window {
    auraAtalhoTeclas?: () => string[];
    auraAtalhoRotulo?: (teclas: string[]) => string;
    auraAtalhoDefinir?: (teclas: string[]) => void;
    auraAtalhoGravar?: (
      aoFim: (teclas: string[]) => void,
      aoEstado: (estado: string, gravando: boolean) => void,
    ) => void;
  }
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function gravar(
  aoFim: (teclas: string[]) => void,
  aoEstado: (estado: string, gravando: boolean) => void,
): Promise<void> {
  const segurados = new Map<string, string>(); // code -> nome, teclas pressionadas agora
  let pico = new Map<string, string>(); // maior combinação vista durante a gravação
  let encerrou = false;

  const limpar = () => {
    window.removeEventListener("keydown", aoBaixo, true);
    window.removeEventListener("keyup", aoSoltar, true);
    window.removeEventListener("blur", aoPerderFoco);
  };

  const encerrar = async (teclas: string[] | null, mensagem?: string) => {
    if (encerrou) return;
    encerrou = true;
    limpar();
    await invoke("cancelar_gravacao").catch(() => undefined);
    await invoke("atalho_gravado").catch(() => undefined); // descarta gravação pendente do Rust
    if (teclas && teclas.length) {
      window.auraAtalhoDefinir?.(teclas);
      aoFim(teclas);
    } else {
      aoEstado(mensagem ?? "Gravação cancelada.", false);
    }
  };

  const aoBaixo = (e: KeyboardEvent) => {
    if (encerrou) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape" && pico.size === 0) {
      void encerrar(null, "Gravação cancelada.");
      return;
    }
    const nome = nomeDoCodigo(e.code);
    if (!nome || e.repeat) return;
    segurados.set(e.code, nome);
    if (segurados.size > pico.size) pico = new Map(segurados);
    aoEstado(`Segurando: ${rotuloAtalho([...segurados.values()])}`, true);
  };

  const aoSoltar = (e: KeyboardEvent) => {
    if (encerrou) return;
    e.preventDefault();
    e.stopPropagation();
    segurados.delete(e.code);
    if (segurados.size === 0 && pico.size > 0) {
      void encerrar([...pico.values()]);
    } else if (pico.size > 0) {
      aoEstado(`Detectado: ${rotuloAtalho([...pico.values()])} — solte as teclas`, true);
    }
  };

  const aoPerderFoco = () => {
    if (!encerrou && pico.size > 0) void encerrar([...pico.values()]);
  };

  // A janela da ilha é sem borda e nasce sem foco: sem isso o webview pode não receber o teclado
  await getCurrentWindow().setFocus().catch(() => undefined);

  try {
    await invoke("gravar_atalho");
  } catch (e) {
    console.error("Erro ao gravar atalho:", e);
    aoEstado("Não consegui gravar o atalho.", false);
    return;
  }

  aoEstado("Pressione a combinação de teclas…", true);
  window.addEventListener("keydown", aoBaixo, true);
  window.addEventListener("keyup", aoSoltar, true);
  window.addEventListener("blur", aoPerderFoco);

  const limite = Date.now() + TEMPO_LIMITE_MS;
  while (!encerrou && Date.now() < limite) {
    await esperar(120);
    const teclas = await invoke<string[] | null>("atalho_gravado").catch(() => null);
    if (teclas && teclas.length) {
      await encerrar(teclas);
      return;
    }
    // Feedback ao vivo pelo hook global quando o webview não está recebendo as teclas
    if (!encerrou && pico.size === 0) {
      const agora = await invoke<string[]>("atalho_segurando").catch(() => []);
      if (agora.length) aoEstado(`Segurando: ${rotuloAtalho(agora)}`, true);
    }
  }
  if (!encerrou) {
    if (pico.size > 0) await encerrar([...pico.values()]);
    else await encerrar(null, "Tempo esgotado. Tente gravar de novo.");
  }
}

export function iniciarAtalho(): void {
  window.auraAtalhoTeclas = carregarSalvo;
  window.auraAtalhoRotulo = rotuloAtalho;
  window.auraAtalhoDefinir = (teclas) => {
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify(teclas));
    invoke("definir_atalho", { teclas }).catch((e) => console.error("Atalho:", e));
  };
  window.auraAtalhoGravar = (aoFim, aoEstado) => void gravar(aoFim, aoEstado);

  // Reaplica o atalho salvo ao iniciar
  window.auraAtalhoDefinir(carregarSalvo());
}
