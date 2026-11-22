import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  Play, Pause, SkipBack, SkipForward, MessageSquare, ChevronLeft, ChevronRight,
  RotateCcw, Droplets, Sliders, Upload, Copy, Check, Plus, Pencil, Trash2,
  Home, Sparkles, Music as MusicIcon, Clock, Inbox, ClipboardList, CheckSquare,
  Volume2, Bluetooth, Headphones, BatteryCharging, MoreHorizontal, Bell,
  Send, Terminal, FileText, Image as ImageIcon, Code2, X,
  Settings as SettingsIcon, FolderOpen, Folder, Link2, KeyRound, Unlink, Loader2, Mic,
  Timer as TimerIcon
} from 'lucide-react';
import { ESTADO, notificar, type Notificacao, type Aprovacao } from '../core/estado';
import { PREFS, type FormatoIlha } from '../core/preferencias';
import { ModeloIA } from '../core/ia';
import { buscarLetra, type Letra } from '../core/letras';
import { buscarCapa } from '../core/capa';
import { infoArquivos, revelarArquivo, clipboardArquivos, formatarTamanho } from '../core/arquivos';
import { vincularSpotify, REDIRECT_URI } from '../core/spotify-vinculo';
import type { Midia } from '../core/midia';
import { Mascote, type EstadoMascote } from './Mascote';
import { RolagemNumero } from './RolagemNumero';

// ============================================================================
// TIPAGEM
// ============================================================================

type IslandMode =
  | 'resting'
  | 'closed'
  | 'ai_chat'
  | 'music'
  | 'focus'
  | 'water'
  | 'shelf'
  | 'clipboard'
  | 'todo'
  | 'widgets'
  | 'settings'
  | 'headphones'
  | 'charging'
  | 'notification'
  | 'timer'
  | 'aprovacao';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

/** Arquivo copiado (Ctrl+C no Explorer) — o clipboard mostra somente arquivos. */
interface ClipFile {
  id: string;
  name: string;
  path: string;
  size: string;
  copiedAt: number;
}

interface ShelfFile {
  id: string;
  name: string;
  size: string;
  type: 'image' | 'doc' | 'code';
  path: string; // vazio quando veio do navegador (sem caminho real)
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

// ============================================================================
// AUXILIARES
// ============================================================================

/** useState que persiste no localStorage (sobrevive a reinícios do app). */
function usePersistido<T>(chave: string, inicial: T) {
  const [valor, setValor] = useState<T>(() => {
    try {
      const salvo = localStorage.getItem(chave);
      return salvo ? (JSON.parse(salvo) as T) : inicial;
    } catch {
      return inicial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem storage */ }
  }, [chave, valor]);
  return [valor, setValor] as const;
}

const TEMPORARIOS: IslandMode[] = ['notification', 'charging', 'headphones'];
const EXPANDIDOS: IslandMode[] = ['ai_chat', 'music', 'focus', 'timer', 'water', 'shelf', 'clipboard', 'todo', 'widgets', 'settings'];
const COPO_ML = 250;

/** Ícones da home, divididos em páginas (estilo tela inicial do iPhone). */
const ATALHOS_HOME: { id: IslandMode; titulo: string; icone: React.ReactNode }[] = [
  { id: 'ai_chat', titulo: 'IA & Sistema', icone: <Sparkles className="w-5 h-5" /> },
  { id: 'music', titulo: 'Música & Letras', icone: <MusicIcon className="w-5 h-5" /> },
  { id: 'focus', titulo: 'Pomodoro', icone: <Clock className="w-5 h-5" /> },
  { id: 'timer', titulo: 'Timer', icone: <TimerIcon className="w-5 h-5" /> },
  { id: 'water', titulo: 'Lembrete de Água', icone: <Droplets className="w-5 h-5" /> },
  { id: 'shelf', titulo: 'Arquivos', icone: <Inbox className="w-5 h-5" /> },
  { id: 'clipboard', titulo: 'Clipboard', icone: <ClipboardList className="w-5 h-5" /> },
  { id: 'todo', titulo: 'Tarefas', icone: <CheckSquare className="w-5 h-5" /> },
  { id: 'settings', titulo: 'Configurações', icone: <SettingsIcon className="w-5 h-5" /> },
];
const PAGINAS_HOME = [ATALHOS_HOME.slice(0, 5), ATALHOS_HOME.slice(5)];

function chaveDoDia(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tipoDoArquivo(nome: string): ShelfFile['type'] {
  if (/\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(nome)) return 'image';
  if (/\.(tsx?|jsx?|rs|py|json|html?|css|md|toml|ya?ml|cs|java|cpp?|go)$/i.test(nome)) return 'code';
  return 'doc';
}

function haQuantoTempo(ts: number, agora: number) {
  const s = Math.max(0, Math.round((agora - ts) / 1000));
  if (s < 60) return 'Agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  return `há ${Math.floor(s / 3600)} h`;
}

function nomeDoApp(app: string) {
  const a = app.toLowerCase();
  if (a.includes('spotify')) return 'Spotify';
  if (a.includes('applemusic') || a.includes('itunes') || a.includes('apple')) return 'Apple Music';
  if (a.includes('chrome') || a.includes('msedge') || a.includes('firefox') || a.includes('opera') || a.includes('brave')) return 'Navegador';
  if (a.includes('zunemusic') || a.includes('media.player') || a.includes('groove')) return 'Windows Media';
  const limpo = app.replace(/\.exe$/i, '').split(/[!_.]/)[0];
  return limpo || 'Windows Media';
}

const controleMidia = (acao: 'playpause' | 'next' | 'prev') => window.auraMidiaControle?.(acao);
const irParaPosicao = (segundos: number) =>
  invoke('midia_posicao', { segundos }).catch((e) => console.error('Posição da mídia:', e));

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export default function App() {
  // Estado principal do modo da Ilha Dinâmica (nasce recolhida, como "resting")
  const [mode, setMode] = useState<IslandMode>('resting');
  const modeRef = useRef<IslandMode>(mode);
  modeRef.current = mode;
  const modoAntes = useRef<IslandMode>('widgets');
  const timerTemporario = useRef<number | undefined>(undefined);
  const timerRecolher = useRef<number | undefined>(undefined);
  const [isHovered, setIsHovered] = useState(false);

  // Formato da ilha: notch colado no topo ou pupila flutuante
  const [formato, setFormato] = useState<FormatoIlha>(() => PREFS.formato());

  // Estado compartilhado com o assistente (estado da voz, nome, timer, água...)
  const [snap, setSnap] = useState(() => ESTADO.ler());

  // Relógio, data e bateria reais
  const [timeStr, setTimeStr] = useState('--:--');
  const [dateStr, setDateStr] = useState('');
  const [agora, setAgora] = useState(Date.now());
  const [batteryLevel, setBatteryLevel] = useState(100);
  const [fone, setFone] = useState('Dispositivo de áudio');

  // Chat IA & Execução do Sistema (segunda aba)
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const aiBusy = snap.estado !== 'ocioso';
  const isAiThinking = aiBusy;

  // Atividade de IA/sistema exibida na Home (some ao ser dispensada)
  const [aiSystemTaskLabel, setAiSystemTaskLabel] = useState<string | null>(null);
  const aiSystemTaskActive = aiSystemTaskLabel !== null;

  // Notificações do assistente (banner na ilha)
  const [fila, setFila] = useState<Notificacao[]>([]);
  const [notifAtual, setNotifAtual] = useState<Notificacao | null>(null);

  // Música & Letras: sessão de mídia do Windows (Spotify, Apple Music, navegador...)
  const [midia, setMidia] = useState<Midia | null>(null);
  const [trackProgress, setTrackProgress] = useState(0);
  const midiaRef = useRef<{ m: Midia | null; t: number }>({ m: null, t: 0 });
  const [showLyrics, setShowLyrics] = useState(false);
  const [letra, setLetra] = useState<Letra | null | 'carregando'>(null);
  const [capa, setCapa] = useState<string | null>(null);
  const isPlaying = !!midia?.tocando;
  const mediaSource = midia ? nomeDoApp(midia.app) : 'Windows Media';
  const trackDuration = Math.max(0, Math.round(midia?.duracao_s ?? 0));
  const chaveFaixa = midia ? `${midia.artista}|${midia.titulo}` : '';

  // Pomodoro / Timer de foco
  const [pomodoroTotal, setPomodoroTotal] = useState(25 * 60);
  const [pomodoroSeconds, setPomodoroSeconds] = useState(25 * 60);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroRound, setPomodoroRound] = useState(1);

  // Lembrete de água (histórico por hora salvo por dia)
  const [waterGoal, setWaterGoal] = usePersistido<number>('aura_agua_meta', 2.0);
  const [waterReminderEnabled, setWaterReminderEnabled] = usePersistido<boolean>('aura_agua_lembrete', true);
  const [waterLog, setWaterLog] = usePersistido<Record<string, number[]>>('aura_agua_log', {});
  const [showWaterSettings, setShowWaterSettings] = useState(false);
  const logHoje = waterLog[chaveDoDia()] ?? new Array(24).fill(0);
  const waterIntake = logHoje.reduce((a, b) => a + b, 0) / 1000;

  // Shelf / Área de Arquivos (começa vazia: nada de print estático)
  const [shelfFiles, setShelfFiles] = usePersistido<ShelfFile[]>('aura_shelf', []);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const expandiuPorArraste = useRef(false);

  // Clipboard: somente arquivos copiados
  const [clipFiles, setClipFiles] = usePersistido<ClipFile[]>('aura_clip_arquivos', []);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Lista de Tarefas
  const [todos, setTodos] = usePersistido<TodoItem[]>('aura_todos', []);
  const [newTodoText, setNewTodoText] = useState('');
  const [isAddingTodo, setIsAddingTodo] = useState(false);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoText, setEditingTodoText] = useState('');

  // Configurações
  const [chaveGemini, setChaveGemini] = useState(() => PREFS.chaveGemini());
  const [geminiMsg, setGeminiMsg] = useState('');
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [spotifyClientId, setSpotifyClientId] = useState(() => PREFS.spotifyClientId());
  const [spotifyVinculado, setSpotifyVinculado] = useState(() => !!PREFS.spotifyRefreshToken());
  const [spotifyMsg, setSpotifyMsg] = useState('');
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [atalhoRotulo, setAtalhoRotulo] = useState('Nenhum');
  const [atalhoMsg, setAtalhoMsg] = useState('');
  const [gravandoAtalho, setGravandoAtalho] = useState(false);
  const atalhoGravandoRef = useRef(false);

  // Aprovações pendentes (Claude, Gemini...) e reação temporária do mascote
  const [pendencias, setPendencias] = useState<Aprovacao[]>([]);
  const [reacao, setReacao] = useState<EstadoMascote | null>(null);

  // Home: página de ícones com arraste horizontal
  const [paginaHome, setPaginaHome] = useState(0);
  const [arrasteHome, setArrasteHome] = useState(0);
  const arrasteHomeRef = useRef<{ x: number; movida: boolean } | null>(null);
  const paginaMovidaRef = useRef(false);

  // Deslizar entre seções da ilha
  const deslizeRef = useRef<{ x: number; y: number } | null>(null);
  const deslizouRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --------------------------------------------------------------------------
  // Assistente: estado, mensagens do chat e notificações
  // --------------------------------------------------------------------------
  useEffect(() => ESTADO.assinar(() => setSnap(ESTADO.ler())), []);

  useEffect(() => {
    setPendencias(ESTADO.pendencias());
    return ESTADO.assinar(() => setPendencias(ESTADO.pendencias()));
  }, []);

  useEffect(() => {
    let ultimaNotif = ESTADO.instantaneo(-1, 0).seq_notif;
    let ultimaMsg = 0;
    const sincronizar = () => {
      const s = ESTADO.instantaneo(ultimaNotif, ultimaMsg);
      if (s.mensagens.length) {
        ultimaMsg = s.mensagens[s.mensagens.length - 1].id;
        setAiMessages((prev) => [
          ...prev,
          ...s.mensagens.map((m) => ({
            id: `m${m.id}`,
            role: (m.de === 'user' ? 'user' : 'assistant') as ChatMessage['role'],
            text: m.texto,
          })),
        ].slice(-100));
        const ultima = s.mensagens[s.mensagens.length - 1];
        setAiSystemTaskLabel(ultima.de === 'user' ? `Executando: ${ultima.texto}` : ultima.texto);
      }
      if (s.notificacoes.length) {
        ultimaNotif = s.seq_notif;
        setFila((prev) => [...prev, ...s.notificacoes].slice(-10));
      }
    };
    sincronizar();
    return ESTADO.assinar(sincronizar);
  }, []);

  /** Mostra um modo temporário (notificação, carregando, fones) e depois volta ao anterior. */
  const mostrarTemporario = useCallback((modo: IslandMode, ms: number) => {
    if (modeRef.current === 'ai_chat' || modeRef.current === 'settings' || modeRef.current === 'aprovacao') return false;
    if (!TEMPORARIOS.includes(modeRef.current)) modoAntes.current = modeRef.current;
    setMode(modo);
    window.clearTimeout(timerTemporario.current);
    timerTemporario.current = window.setTimeout(() => {
      setNotifAtual(null);
      setMode((m) => (TEMPORARIOS.includes(m) ? modoAntes.current : m));
    }, ms);
    return true;
  }, []);

  useEffect(() => {
    if (notifAtual || fila.length === 0) return;
    const [prox, ...resto] = fila;
    setFila(resto);
    if (mostrarTemporario('notification', Math.min(Math.max(prox.duracao_ms, 2200), 6000))) setNotifAtual(prox);
  }, [fila, notifAtual, mostrarTemporario]);

  // Aprovação pendente interrompe qualquer seção; ao responder, a ilha volta ao que estava
  useEffect(() => {
    const atual = modeRef.current;
    if (pendencias.length > 0) {
      if (atual !== 'aprovacao') {
        if (!TEMPORARIOS.includes(atual)) modoAntes.current = atual;
        setMode('aprovacao');
      }
    } else if (atual === 'aprovacao') {
      setMode(modoAntes.current);
    }
  }, [pendencias]);

  // Relógio em tempo real em Português
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setTimeStr(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
      const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      setDateStr(`${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`);
      setAgora(now.getTime());
    };
    updateClock();
    const interval = setInterval(updateClock, 15000);
    return () => clearInterval(interval);
  }, []);

  // Bateria real (mostra "Carregando" ao plugar o carregador)
  useEffect(() => {
    let bat: any;
    let aoMudar: (() => void) | undefined;
    let aoCarregar: (() => void) | undefined;
    (navigator as any).getBattery?.().then((b: any) => {
      bat = b;
      aoMudar = () => setBatteryLevel(Math.round(b.level * 100));
      aoCarregar = () => { if (b.charging && b.level < 1) mostrarTemporario('charging', 4000); };
      aoMudar();
      b.addEventListener('levelchange', aoMudar);
      b.addEventListener('chargingchange', aoCarregar);
    }).catch(() => undefined);
    return () => {
      if (bat && aoMudar) bat.removeEventListener('levelchange', aoMudar);
      if (bat && aoCarregar) bat.removeEventListener('chargingchange', aoCarregar);
    };
  }, [mostrarTemporario]);

  // Novo dispositivo de áudio (fones Bluetooth etc.)
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    let conhecidos = new Set<string>();
    const saidas = async () => (await md.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    saidas().then((ds) => { conhecidos = new Set(ds.map((d) => d.deviceId)); }).catch(() => undefined);
    const aoMudar = async () => {
      const ds = await saidas();
      const novo = ds.find((d) => !conhecidos.has(d.deviceId));
      conhecidos = new Set(ds.map((d) => d.deviceId));
      if (novo) {
        setFone(novo.label || 'Novo dispositivo de áudio');
        mostrarTemporario('headphones', 4000);
      }
    };
    md.addEventListener('devicechange', aoMudar);
    return () => md.removeEventListener('devicechange', aoMudar);
  }, [mostrarTemporario]);

  // --------------------------------------------------------------------------
  // Arrastar arquivos (Tauri entrega os caminhos reais; HTML5 fica de reserva)
  // --------------------------------------------------------------------------
  const adicionarCaminhos = useCallback(async (caminhos: string[]) => {
    try {
      const infos = await infoArquivos(caminhos);
      const base = Date.now();
      const novos: ShelfFile[] = infos.map((i, idx) => ({
        id: `${base}-${idx}`,
        name: i.nome,
        path: i.caminho,
        size: i.pasta ? 'Pasta' : formatarTamanho(i.tamanho),
        type: tipoDoArquivo(i.nome),
      }));
      setShelfFiles((prev) => [...novos, ...prev.filter((p) => !infos.some((i) => i.caminho === p.path))].slice(0, 30));
    } catch (e) {
      console.error('Não consegui ler os arquivos soltos:', e);
    }
  }, [setShelfFiles]);

  const abrirShelfPorArraste = useCallback(() => {
    if (modeRef.current !== 'shelf') {
      expandiuPorArraste.current = true;
      if (!TEMPORARIOS.includes(modeRef.current)) modoAntes.current = modeRef.current;
      setMode('shelf');
    }
  }, []);

  useEffect(() => {
    let cancelar: (() => void) | undefined;
    try {
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === 'enter') {
          setIsDraggingOver(true);
          abrirShelfPorArraste();
        } else if (p.type === 'leave') {
          setIsDraggingOver(false);
          if (expandiuPorArraste.current && modeRef.current === 'shelf') setMode(modoAntes.current);
          expandiuPorArraste.current = false;
        } else if (p.type === 'drop') {
          setIsDraggingOver(false);
          expandiuPorArraste.current = false;
          void adicionarCaminhos(p.paths);
          setMode('shelf');
        }
      }).then((un) => { cancelar = un; }).catch(() => undefined);
    } catch { /* rodando fora do Tauri */ }
    return () => cancelar?.();
  }, [abrirShelfPorArraste, adicionarCaminhos]);

  // Reserva para navegador (sem Tauri): eventos HTML5 de arrastar
  useEffect(() => {
    const aoEntrar = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDraggingOver(true);
        if (modeRef.current === 'resting' || modeRef.current === 'closed') setMode('shelf');
      }
    };
    window.addEventListener('dragenter', aoEntrar);
    return () => window.removeEventListener('dragenter', aoEntrar);
  }, []);

  // --------------------------------------------------------------------------
  // Clipboard: só arquivos copiados no Explorer
  // --------------------------------------------------------------------------
  useEffect(() => {
    let seq = 0;
    const ciclo = async () => {
      try {
        const r = await clipboardArquivos(seq);
        if (!r) return;
        seq = r.seq;
        if (!r.caminhos.length) return;
        const infos = await infoArquivos(r.caminhos);
        const t = Date.now();
        setClipFiles((prev) => [
          ...infos.map((i) => ({
            id: `${t}-${i.caminho}`,
            name: i.nome,
            path: i.caminho,
            size: i.pasta ? 'Pasta' : formatarTamanho(i.tamanho),
            copiedAt: t,
          })),
          ...prev.filter((p) => !infos.some((i) => i.caminho === p.path)),
        ].slice(0, 12));
      } catch { /* fora do Tauri ou clipboard ocupado */ }
    };
    void ciclo();
    const id = setInterval(() => void ciclo(), 1200);
    return () => clearInterval(id);
  }, [setClipFiles]);

  // --------------------------------------------------------------------------
  // Música: sincroniza com a sessão de mídia do Windows (Spotify, etc.)
  // --------------------------------------------------------------------------
  useEffect(() => {
    window.auraMidiaAtualizar = (m) => {
      midiaRef.current = { m, t: Date.now() };
      setMidia(m);
    };
    return () => { window.auraMidiaAtualizar = undefined; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const { m, t } = midiaRef.current;
      if (!m) { setTrackProgress(0); return; }
      const extra = m.tocando ? (Date.now() - t) / 1000 : 0;
      const p = m.posicao_s + extra;
      setTrackProgress(m.duracao_s > 0 ? Math.min(p, m.duracao_s) : p);
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Capa do álbum quando a faixa muda
  useEffect(() => {
    setCapa(null);
    if (!midia) return;
    let vivo = true;
    void buscarCapa(midia.titulo, midia.artista).then((u) => { if (vivo) setCapa(u); });
    return () => { vivo = false; };
  }, [chaveFaixa]); // eslint-disable-line react-hooks/exhaustive-deps

  // Letra: busca só quando a pessoa abre o balãozinho
  useEffect(() => {
    if (!showLyrics || !midia) return;
    let vivo = true;
    setLetra('carregando');
    void buscarLetra(midia.titulo, midia.artista, midia.duracao_s).then((l) => { if (vivo) setLetra(l); });
    return () => { vivo = false; };
  }, [showLyrics, chaveFaixa]); // eslint-disable-line react-hooks/exhaustive-deps

  const linhasLetra = letra && letra !== 'carregando' ? letra.linhas : [];
  const letraSincronizada = !!letra && letra !== 'carregando' && letra.sincronizada;
  let lyricIndex = 0;
  if (letraSincronizada) {
    const alvo = trackProgress + 0.3;
    lyricIndex = 0;
    for (let i = 0; i < linhasLetra.length; i++) {
      if (linhasLetra[i].t <= alvo) lyricIndex = i; else break;
    }
  }

  // --------------------------------------------------------------------------
  // Pomodoro (e timer pedido por voz: "timer 10 minutos")
  // --------------------------------------------------------------------------
  const prevFoco = useRef(false);
  const prevTimerMin = useRef(0);
  useEffect(() => {
    if (snap.foco && snap.timer_minutos > 0 && (!prevFoco.current || prevTimerMin.current !== snap.timer_minutos)) {
      setPomodoroTotal(snap.timer_minutos * 60);
      setPomodoroSeconds(snap.timer_minutos * 60);
      setPomodoroRunning(true);
    }
    if (!snap.foco && prevFoco.current) setPomodoroRunning(false);
    prevFoco.current = snap.foco;
    prevTimerMin.current = snap.timer_minutos;
  }, [snap.foco, snap.timer_minutos]);

  useEffect(() => {
    if (!pomodoroRunning) return;
    const id = setInterval(() => {
      setPomodoroSeconds((s) => {
        if (s > 1) return s - 1;
        setPomodoroRunning(false);
        setPomodoroRound((r) => Math.min(4, r + 1));
        notificar('Foco concluído', 'Hora de uma pausa', 'notification', 4000);
        return pomodoroTotal;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [pomodoroRunning, pomodoroTotal]);

  // --------------------------------------------------------------------------
  // Água: "bebi água" por voz também entra no histórico; lembrete a cada hora
  // --------------------------------------------------------------------------
  const prevCopos = useRef(snap.agua_copos);
  const registrarAgua = useCallback((ml: number) => {
    const hoje = chaveDoDia();
    const hora = new Date().getHours();
    setWaterLog((prev) => {
      const dia = [...(prev[hoje] ?? new Array(24).fill(0))];
      dia[hora] += ml;
      return { [hoje]: dia }; // guarda só o dia de hoje
    });
  }, [setWaterLog]);

  useEffect(() => {
    if (snap.agua_copos > prevCopos.current) registrarAgua((snap.agua_copos - prevCopos.current) * COPO_ML);
    prevCopos.current = snap.agua_copos;
  }, [snap.agua_copos, registrarAgua]);

  useEffect(() => {
    if (!waterReminderEnabled) return;
    const id = setInterval(() => notificar('Hidratação', 'Hora de beber água', 'notification', 4000), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [waterReminderEnabled]);

  // Auto-scroll no chat IA
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  // Ao abrir Configurações, lê o atalho gravado
  useEffect(() => {
    if (mode === 'settings') {
      setAtalhoRotulo(window.auraAtalhoRotulo?.(window.auraAtalhoTeclas?.() ?? []) ?? 'Nenhum');
    }
  }, [mode]);

  // Recolhe sozinha depois que o mouse sai (não recolhe no chat/configurações com digitação)
  const aoSairMouse = () => {
    setIsHovered(false);
    window.clearTimeout(timerRecolher.current);
    timerRecolher.current = window.setTimeout(() => {
      const ativo = document.activeElement;
      const digitando = ativo instanceof HTMLInputElement && ativo.value.length > 0;
      if (EXPANDIDOS.includes(modeRef.current) && !digitando && !atalhoGravandoRef.current) setMode('closed');
    }, 7000);
  };
  const aoEntrarMouse = () => {
    setIsHovered(true);
    window.clearTimeout(timerRecolher.current);
  };

  // Formata segundos para MM:SS
  const formatTime = (sec: number) => {
    const t = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };

  // Envio de comando ou pergunta: o assistente decide se executa no sistema ou responde
  const handleSendAiCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const texto = aiInput.trim();
    if (!texto) return;
    setAiInput('');
    window.aura?.comando(texto);
  };

  // Abre o arquivo copiado no Explorer / copia o caminho
  const handleCopyPath = async (id: string, caminho: string) => {
    try {
      await writeText(caminho);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err) {
      console.error('Erro ao copiar o caminho:', err);
    }
  };

  // Manipuladores de Tarefas
  const toggleTodo = (id: string) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const addTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoText.trim()) return;
    setTodos((prev) => [...prev, { id: Date.now().toString(), text: newTodoText.trim(), done: false }]);
    setNewTodoText('');
    setIsAddingTodo(false);
  };

  const saveEditTodo = (id: string) => {
    if (editingTodoText.trim()) {
      setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, text: editingTodoText.trim() } : t)));
    }
    setEditingTodoId(null);
  };

  // Shelf: reserva HTML5 (navegador) — no Tauri os caminhos reais chegam pelo evento de arrastar
  const processDroppedFiles = (fileList: File[]) => {
    const mapped: ShelfFile[] = fileList.map((f, i) => ({
      id: `${Date.now()}-${i}`,
      name: f.name,
      path: (f as File & { path?: string }).path ?? '',
      size: formatarTamanho(f.size),
      type: tipoDoArquivo(f.name),
    }));
    setShelfFiles((prev) => [...mapped, ...prev].slice(0, 30));
    setMode('shelf');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      processDroppedFiles(files);
      setReacao('swallow');
      window.setTimeout(() => setReacao(null), 1700);
    }
  };

  // Navegação cíclica entre abas expandidas (< e >)
  const expandedModes = EXPANDIDOS;
  const cycleMode = (dir: -1 | 1) => {
    const idx = expandedModes.indexOf(mode);
    if (idx === -1) {
      setMode('music');
      return;
    }
    setMode(expandedModes[(idx + dir + expandedModes.length) % expandedModes.length]);
  };

  // Configurações: Gemini, Spotify, formato e atalho
  const salvarGemini = async () => {
    PREFS.definirChaveGemini(chaveGemini);
    if (!chaveGemini.trim()) { setGeminiMsg('Chave removida.'); return; }
    setGeminiBusy(true);
    setGeminiMsg('Testando...');
    try {
      await new ModeloIA().gerar('Responda somente com o JSON {"ok": true}');
      setGeminiMsg('Chave salva e funcionando ✓');
    } catch {
      setGeminiMsg('Salva, mas o Gemini recusou — confira a chave.');
    } finally {
      setGeminiBusy(false);
    }
  };

  const vincular = async () => {
    setSpotifyBusy(true);
    setSpotifyMsg('Autorize no navegador que abriu...');
    try {
      await vincularSpotify(spotifyClientId);
      setSpotifyVinculado(true);
      setSpotifyMsg('Spotify vinculado ✓');
    } catch (e) {
      setSpotifyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSpotifyBusy(false);
    }
  };

  const desvincular = () => {
    PREFS.desvincularSpotify();
    setSpotifyClientId('');
    setSpotifyVinculado(false);
    setSpotifyMsg('Spotify desvinculado.');
  };

  const escolherFormato = (f: FormatoIlha) => {
    PREFS.definirFormato(f);
    setFormato(f);
  };

  const gravarAtalho = () => {
    if (!window.auraAtalhoGravar) {
      setAtalhoMsg('Disponível só no app.');
      return;
    }
    atalhoGravandoRef.current = true;
    setGravandoAtalho(true);
    window.auraAtalhoGravar(
      (teclas) => {
        atalhoGravandoRef.current = false;
        setGravandoAtalho(false);
        setAtalhoRotulo(window.auraAtalhoRotulo?.(teclas) ?? teclas.join(' + '));
        setAtalhoMsg('Atalho salvo ✓');
      },
      (estado, gravando) => {
        atalhoGravandoRef.current = gravando;
        setGravandoAtalho(gravando);
        setAtalhoMsg(estado);
      },
    );
  };

  // Determina dimensões visuais do container da Ilha Dinâmica
  const formatarCantos = (c: string) => (formato === 'pupila' ? c.replace(/rounded-b-\[\d+px\]/, 'rounded-[32px]') : c);
  const getIslandDimensions = () => formatarCantos(dimensoesBase());
  const dimensoesBase = () => {
    switch (mode) {
      case 'resting':
        return 'w-[115px] h-[28px] rounded-b-[16px]';
      case 'closed':
        return 'w-[205px] h-[34px] rounded-b-[18px]';
      case 'headphones':
        return 'w-[340px] h-[66px] rounded-b-[24px]';
      case 'charging':
        return 'w-[290px] h-[56px] rounded-b-[22px]';
      case 'notification':
        return 'w-[360px] h-[74px] rounded-b-[24px]';
      case 'ai_chat':
        return 'w-[94vw] max-w-[470px] h-[184px] rounded-b-[28px]';
      case 'music':
        return showLyrics && midia
          ? 'w-[95vw] max-w-[550px] h-[160px] rounded-b-[28px]'
          : 'w-[94vw] max-w-[440px] h-[156px] rounded-b-[28px]';
      case 'focus':
      case 'timer':
      case 'water':
      case 'shelf':
      case 'clipboard':
      case 'todo':
        return 'w-[94vw] max-w-[460px] h-[168px] rounded-b-[28px]';
      case 'aprovacao':
        return 'w-[92vw] max-w-[380px] h-[84px] rounded-b-[26px]';
      case 'settings':
        return 'w-[95vw] max-w-[520px] h-[236px] rounded-b-[28px]';
      case 'widgets':
      default:
        return 'w-[95vw] max-w-[580px] h-[238px] rounded-b-[30px]';
    }
  };

  // ==========================================================================
  // COMPONENTES INTERNOS REUTILIZÁVEIS
  // ==========================================================================

  // Mascote: a expressão segue a ilha (aprovação > notificação > IA > música > repouso)
  const TIPO_PARA_MASCOTE: Record<string, EstadoMascote> = {
    success: 'success', error: 'error', swallow: 'swallow', dancing: 'dancing',
  };
  const estadoMascote: EstadoMascote = pendencias.length > 0
    ? 'pending'
    : notifAtual
    ? (TIPO_PARA_MASCOTE[notifAtual.tipo] ?? 'notification')
    : snap.estado === 'pensando'
    ? 'thinking'
    : snap.estado === 'ouvindo' || snap.estado === 'falando'
    ? 'listening'
    : aiSystemTaskActive
    ? 'working'
    : isPlaying
    ? 'dancing'
    : 'idle';

  const decidirAprovacao = (aceito: boolean) => {
    const atual = pendencias[0];
    if (!atual) return;
    ESTADO.responderAprovacao(atual.id, aceito);
    setReacao(aceito ? 'success' : 'denied');
    window.setTimeout(() => setReacao(null), 2000);
  };

  // Mascote no lugar da bolinha verde: mesmo estado/reação em todos os modos da ilha (função, não componente)
  const MascoteIlha = (tamanho = 20) => <Mascote estado={reacao ?? estadoMascote} tamanho={tamanho} />;

  // Deslizar a ilha para trocar de seção (só nas seções expandidas)
  const aoPressionarIlha = (e: React.PointerEvent) => {
    deslizouRef.current = false;
    deslizeRef.current = null;
    if (!EXPANDIDOS.includes(modeRef.current)) return;
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    deslizeRef.current = { x: e.clientX, y: e.clientY };
  };
  const aoSoltarIlha = (e: React.PointerEvent) => {
    const inicio = deslizeRef.current;
    deslizeRef.current = null;
    if (!inicio) return;
    const dx = e.clientX - inicio.x;
    const dy = e.clientY - inicio.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      deslizouRef.current = true;
      cycleMode(dx < 0 ? 1 : -1);
    }
  };

  // Páginas de ícones da home: arraste horizontal (as bolinhas também trocam)
  const aoPressionarPagina = (e: React.PointerEvent) => {
    arrasteHomeRef.current = { x: e.clientX, movida: false };
    paginaMovidaRef.current = false;
    deslizouRef.current = false; // o gesto da página não passa pela ilha, então zera aqui
    e.stopPropagation();
  };
  const aoMoverPagina = (e: React.PointerEvent) => {
    const inicio = arrasteHomeRef.current;
    if (!inicio) return;
    const dx = e.clientX - inicio.x;
    if (!inicio.movida && Math.abs(dx) > 6) {
      inicio.movida = true;
      paginaMovidaRef.current = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sem captura */ }
    }
    if (inicio.movida) setArrasteHome(dx);
  };
  const aoSoltarPagina = (e: React.PointerEvent) => {
    const inicio = arrasteHomeRef.current;
    arrasteHomeRef.current = null;
    if (!inicio) return;
    e.stopPropagation();
    const dx = e.clientX - inicio.x;
    if (dx < -40 && paginaHome < PAGINAS_HOME.length - 1) setPaginaHome(paginaHome + 1);
    else if (dx > 40 && paginaHome > 0) setPaginaHome(paginaHome - 1);
    setArrasteHome(0);
  };

  const SoundWave = ({ active = isPlaying }: { active?: boolean }) => (
    <div className="flex items-center gap-[2px] h-3.5 px-1">
      {[0.6, 1, 0.45, 0.85, 0.55].map((scale, idx) => (
        <span
          key={idx}
          className={`w-[2px] rounded-full bg-white transition-all duration-300 ${
            active ? 'animate-pulse' : 'opacity-40'
          }`}
          style={{
            height: active ? `${Math.max(4, scale * 13)}px` : '4px',
            animationDelay: `${idx * 120}ms`,
          }}
        />
      ))}
    </div>
  );

  const IslandHeader = ({ title, accentColor = 'text-white' }: { title?: string; accentColor?: string }) => (
    <div className="flex items-center justify-between w-full px-4 pt-2.5 pb-1 text-[11px] font-medium text-zinc-400 select-none">
      <div className="flex items-center gap-2 min-w-[90px]">
        {title && <span className={`font-semibold tracking-tight ${accentColor}`}>{title}</span>}
      </div>

      <div className="flex items-center gap-2 text-zinc-200">
        {MascoteIlha()}
        <span className="text-zinc-400 hidden sm:inline">{dateStr}</span>
        <span className="font-semibold text-white">{timeStr}</span>
      </div>

      <div className="flex items-center justify-end min-w-[90px]">
        {SoundWave({})}
      </div>
    </div>
  );

  const PaginationDots = () => (
    <div className="flex items-center justify-center gap-1.5 pb-2 pt-1">
      {expandedModes.map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          aria-label={`Ir para ${m}`}
          className={`h-1 rounded-full transition-all duration-300 ${
            mode === m ? 'w-3.5 bg-white' : 'w-1 bg-zinc-600 hover:bg-zinc-400'
          }`}
        />
      ))}
    </div>
  );

  const NavArrow = ({ dir }: { dir: -1 | 1 }) => (
    <button
      onClick={() => cycleMode(dir)}
      className="w-6 h-6 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors shrink-0 border border-white/5"
      title={dir === -1 ? 'Anterior' : 'Próximo'}
    >
      {dir === -1 ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
    </button>
  );

  // Capa do álbum (função, não componente: evita recriar a <img> a cada atualização da barra)
  const renderCapa = (pequena: boolean) =>
    capa ? (
      <img
        src={capa}
        alt=""
        className={`${pequena ? 'w-11 h-11' : 'w-12 h-12'} rounded-xl object-cover shrink-0 shadow-inner`}
      />
    ) : (
      <div className={`${pequena ? 'w-11 h-11 p-1' : 'w-12 h-12 p-1.5'} rounded-xl bg-gradient-to-br from-slate-100 to-blue-100 flex items-center justify-center shrink-0 relative overflow-hidden shadow-inner`}>
        <div className="w-full h-full border border-blue-300/60 rounded-lg flex items-center justify-center relative">
          <div className={`${pequena ? 'w-4 h-4' : 'w-5 h-5'} rounded-full bg-blue-500`} />
          <div className="absolute w-8 h-[1.5px] bg-blue-400 -rotate-45" />
        </div>
      </div>
    );

  const LINHA_H = 36;

  // Pular na faixa (otimista: a barra já anda enquanto o Windows confirma)
  const buscarPosicao = (segundos: number) => {
    const { m } = midiaRef.current;
    if (m) midiaRef.current = { m: { ...m, posicao_s: segundos }, t: Date.now() };
    setTrackProgress(segundos);
    void irParaPosicao(segundos);
  };

  const alternarReproducao = () => {
    const { m, t } = midiaRef.current;
    if (m) {
      const posAtual = m.tocando ? m.posicao_s + (Date.now() - t) / 1000 : m.posicao_s;
      midiaRef.current = { m: { ...m, tocando: !m.tocando, posicao_s: posAtual }, t: Date.now() };
      setMidia(midiaRef.current.m);
    }
    controleMidia('playpause');
  };

  // Água: últimas 7 horas
  const horaAtual = new Date().getHours();
  const barrasAgua = Array.from({ length: 7 }, (_, i) => {
    const h = (horaAtual - 6 + i + 24) % 24;
    return { hora: String(h).padStart(2, '0'), ml: logHoje[h] ?? 0 };
  });
  const escalaAgua = Math.max(400, Math.ceil(Math.max(...barrasAgua.map((b) => b.ml)) / 200) * 200);

  // Foco: horário previsto de término
  const fimPomodoro = new Date(agora + pomodoroSeconds * 1000);
  const fimStr = `${String(fimPomodoro.getHours()).padStart(2, '0')}:${String(fimPomodoro.getMinutes()).padStart(2, '0')}`;

  const completedTodos = todos.filter((t) => t.done).length;
  const pendingTodosCount = todos.filter((t) => !t.done).length;

  // Atividades ativas/pendentes dinâmicas para a página Home (nada ativo = mensagem vazia)
  const activeHomeWidgets = [
    aiSystemTaskActive && {
      id: 'ai',
      onClick: () => setMode('ai_chat'),
      gradient: 'linear-gradient(160deg, #0b1320 15%, #0c3559 75%, #1d6fa5 100%)',
      border: 'border-sky-400/20 hover:border-sky-400/50',
      label: 'Assistente IA',
      labelColor: 'text-sky-200/90',
      icon: <Sparkles className="w-4 h-4" />,
      title: isAiThinking ? 'Processando...' : 'Pronto',
      subtitle: aiSystemTaskLabel ?? '',
      subtitleColor: 'text-sky-200/80',
    },
    isPlaying && {
      id: 'music',
      onClick: () => setMode('music'),
      gradient: 'linear-gradient(160deg, #160b10 15%, #4c1122 75%, #881d3b 100%)',
      border: 'border-rose-400/20 hover:border-rose-400/50',
      label: mediaSource,
      labelColor: 'text-rose-200/90',
      icon: <MusicIcon className="w-4 h-4 text-white" />,
      isMusic: true,
      title: midia?.titulo || 'Tocando',
      subtitle: midia?.artista || 'tocando agora',
      subtitleColor: 'text-rose-200/75',
    },
    pomodoroRunning && {
      id: 'focus',
      onClick: () => setMode('focus'),
      gradient: 'linear-gradient(160deg, #130b1c 15%, #3b175e 75%, #6d28d9 100%)',
      border: 'border-purple-400/20 hover:border-purple-400/50',
      label: 'Foco',
      labelColor: 'text-purple-200/90',
      isFocus: true,
      title: formatTime(pomodoroSeconds),
      subtitle: `${Math.ceil(pomodoroSeconds / 60)} min restantes`,
      subtitleColor: 'text-purple-200/80',
    },
    pendingTodosCount > 0 && {
      id: 'todo',
      onClick: () => setMode('todo'),
      gradient: 'linear-gradient(160deg, #091712 15%, #0f3d2e 75%, #15803d 100%)',
      border: 'border-emerald-400/20 hover:border-emerald-400/50',
      label: 'Tarefas',
      labelColor: 'text-emerald-200/90',
      icon: <CheckSquare className="w-4 h-4" />,
      title: `${pendingTodosCount} ${pendingTodosCount === 1 ? 'pendente' : 'pendentes'}`,
      subtitle: todos.find((t) => !t.done)?.text || 'Ver lista',
      subtitleColor: 'text-emerald-200/80',
    },
  ].filter(Boolean).slice(0, 3) as Array<any>;

  return (
    <div className="h-screen w-full flex flex-col items-center select-none font-sans text-white overflow-hidden bg-transparent">
      {/* Brilho animado da área serrilhada e máscara de fade da letra (estilo Apple Music) */}
      <style>{`
        @keyframes rainbowGlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .shelf-drop-glow {
          background: linear-gradient(90deg, #38bdf8, #818cf8, #e879f9, #34d399, #38bdf8);
          background-size: 300% 300%;
          animation: rainbowGlow 2.4s ease infinite;
        }
        .lyric-mask {
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%);
          mask-image: linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%);
        }
      `}</style>

      {/* ====================================================================
          ÁREA DA ILHA DINÂMICA (Ancorada no topo central como Notch do Windows)
      ==================================================================== */}
      <div className={`w-full flex flex-col items-center z-50 ${formato === 'pupila' ? 'pt-2' : ''}`}>

        <div
          id="dynamicIsland"
          onMouseEnter={aoEntrarMouse}
          onMouseLeave={aoSairMouse}
          onPointerDown={aoPressionarIlha}
          onPointerUp={aoSoltarIlha}
          onClickCapture={(e) => {
            if (deslizouRef.current) {
              e.stopPropagation();
              e.preventDefault();
              deslizouRef.current = false;
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
            if (mode === 'resting' || mode === 'closed') {
              setMode('shelf');
            }
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={handleDrop}
          onClick={() => {
            if (mode === 'resting' || mode === 'closed') {
              setMode('widgets');
            }
          }}
          className={`relative bg-[#070709]/95 backdrop-blur-2xl text-white shadow-[0_20px_50px_rgba(0,0,0,0.85)] ${formato === 'pupila' ? 'border' : 'border-x border-b'} transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] flex flex-col justify-between overflow-hidden ${getIslandDimensions()} ${
            isDraggingOver
              ? 'border-sky-400 shadow-[0_0_35px_rgba(56,189,248,0.5)]'
              : 'border-white/[0.08]'
          } ${mode === 'resting' || mode === 'closed' ? 'cursor-pointer hover:scale-[1.03]' : ''}`}
        >
          {/* Indicador sutil de câmera no topo */}
          <div className={`pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-zinc-800/90 mt-1 ${formato === 'pupila' ? 'hidden' : ''}`} />

          {/* ----------------------------------------------------------------
              1. MODO RESTING (Repouso - expande ao arrastar arquivo)
          ---------------------------------------------------------------- */}
          {mode === 'resting' && (
            <div className="w-full h-full flex items-center justify-between px-3.5">
              <Mascote estado={reacao ?? estadoMascote} tamanho={26} />
              <span className="text-[10px] font-medium text-zinc-400 tracking-wider truncate max-w-[56px]">{snap.nome.toUpperCase()}</span>
            </div>
          )}

          {/* ----------------------------------------------------------------
              2. MODO CLOSED (Fechado: Bateria + Hora + Onda Sonora)
          ---------------------------------------------------------------- */}
          {mode === 'closed' && (
            <div className="w-full h-full flex items-center justify-between px-4">
              {MascoteIlha(30)}
              <span className="text-[12px] font-semibold tracking-tight text-white">{timeStr}</span>
              {SoundWave({})}
            </div>
          )}

          {/* ----------------------------------------------------------------
              3. MODO HEADPHONES (Fones Bluetooth conectados)
          ---------------------------------------------------------------- */}
          {mode === 'headphones' && (
            <div className="w-full h-full flex items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <div className="relative w-9 h-9 rounded-full bg-sky-500/15 border border-sky-400/40 flex items-center justify-center">
                  <Bluetooth className="w-4 h-4 text-sky-400" />
                </div>
                <div>
                  <div className="text-[13px] font-semibold text-white leading-tight">{fone}</div>
                  <div className="text-[11px] text-zinc-400">Conectado</div>
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-zinc-900 border border-sky-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(56,189,248,0.2)]">
                <Headphones className="w-4 h-4 text-sky-300" />
              </div>
            </div>
          )}

          {/* ----------------------------------------------------------------
              4. MODO CHARGING (Carregamento rápido)
          ---------------------------------------------------------------- */}
          {mode === 'charging' && (
            <div className="w-full h-full flex items-center justify-between px-5">
              <div className="flex items-center gap-2.5">
                <BatteryCharging className="w-5 h-5 text-emerald-400 animate-pulse" />
                <div>
                  <div className="text-[12px] font-semibold text-white">Carregamento Rápido</div>
                  <div className="text-[10px] text-emerald-400">{batteryLevel}% · carregando</div>
                </div>
              </div>
              <span className="text-lg font-bold text-emerald-400">{batteryLevel}%</span>
            </div>
          )}

          {/* ----------------------------------------------------------------
              5. MODO NOTIFICATION (Notificação do Sistema)
          ---------------------------------------------------------------- */}
          {mode === 'notification' && (
            <div className="w-full h-full flex items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <Mascote estado={estadoMascote} tamanho={38} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-white">{notifAtual?.titulo ?? snap.nome}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">Agora</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 truncate max-w-[205px]">
                    {notifAtual?.mensagem}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMode('widgets')}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-medium"
              >
                Abrir
              </button>
            </div>
          )}

          {/* ----------------------------------------------------------------
              6. SEGUNDA ABA: CHAT INTEGRADO À IA & EXECUÇÃO DO SISTEMA
          ---------------------------------------------------------------- */}
          {mode === 'ai_chat' && (
            <div className="w-full h-full flex flex-col justify-between">
              <div className="flex items-center justify-between w-full px-4 pt-2.5 pb-1 text-[11px] font-medium text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                  <span className="font-semibold text-white">IA & Sistema</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-200">
                  {MascoteIlha()}
                  <span className="text-zinc-400 hidden sm:inline">{dateStr}</span>
                  <span className="font-semibold text-white">{timeStr}</span>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-400/20 flex items-center gap-1">
                  {snap.estado === 'ouvindo' ? <Mic className="w-2.5 h-2.5" /> : <Terminal className="w-2.5 h-2.5" />}{' '}
                  {snap.estado === 'ouvindo' ? 'Ouvindo' : snap.estado === 'pensando' ? 'Pensando' : snap.estado === 'falando' ? 'Falando' : 'Shell'}
                </span>
              </div>

              <div className="flex items-center justify-between px-3 gap-2 flex-1 min-h-0">
                {NavArrow({ dir: -1 })}

                <div className="flex-1 h-full flex flex-col justify-between bg-zinc-900/60 rounded-2xl border border-white/10 p-2 overflow-hidden">
                  {/* Área de mensagens */}
                  <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-[11px]">
                    {aiMessages.length === 0 && (
                      <div className="text-[10px] text-zinc-500 px-1 pt-1 leading-snug">
                        Fale “{snap.nome}” ou digite um comando — ex.: “timer 10 minutos”, “aumentar volume”, “tocar Legião Urbana”.
                      </div>
                    )}
                    {aiMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`px-2.5 py-1 rounded-xl max-w-[85%] leading-snug ${
                            msg.role === 'user'
                              ? 'bg-sky-600 text-white'
                              : 'bg-zinc-800/90 text-zinc-200 border border-white/5'
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    ))}
                    {isAiThinking && (
                      <div className="text-[10px] text-sky-400 animate-pulse px-1">
                        {snap.estado === 'ouvindo' ? 'Ouvindo...' : snap.estado === 'falando' ? 'Falando...' : 'Executando no sistema...'}
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input de comando / prompt */}
                  <form onSubmit={handleSendAiCommand} className="flex items-center gap-1.5 pt-1.5 border-t border-white/5">
                    <input
                      value={aiInput}
                      onChange={(e) => setAiInput(e.target.value)}
                      placeholder="Pergunte à IA ou execute um comando (ex: timer 10 minutos)..."
                      className="flex-1 bg-transparent text-[11px] text-white placeholder-zinc-500 outline-none px-1"
                    />
                    <button
                      type="submit"
                      className="w-6 h-6 rounded-full bg-sky-500 hover:bg-sky-400 text-black flex items-center justify-center transition-colors shrink-0"
                      title="Enviar"
                    >
                      <Send className="w-3 h-3" />
                    </button>
                  </form>
                </div>

                {NavArrow({ dir: 1 })}
              </div>

              {PaginationDots()}
            </div>
          )}

          {/* ----------------------------------------------------------------
              7. ABA DE MÚSICA E LETRA INTEGRADAS (Spotify / Windows SMTC)
              - Só exibe a letra ao clicar no botão de balãozinho!
              - Animação vertical fluida estilo Apple Music no PC
          ---------------------------------------------------------------- */}
          {mode === 'music' && (
            <div
              className={`w-full h-full transition-all duration-500 ${
                showLyrics && midia
                  ? 'flex items-center px-4 py-3 gap-4 bg-gradient-to-r from-[#070709] via-[#0c192c] to-[#102a4c]'
                  : 'flex flex-col justify-between'
              }`}
            >
              {!midia ? (
                /* NADA TOCANDO: reflete a sessão de mídia do Windows assim que algo tocar */
                <>
                  <div className="flex items-center justify-between w-full px-4 pt-2.5 pb-1 text-[11px] font-medium text-zinc-400 select-none">
                    <span className="text-[10px] font-semibold text-zinc-500 min-w-[90px]">● Windows Media</span>
                    <div className="flex items-center gap-2 text-zinc-200">
                      {MascoteIlha()}
                      <span className="text-zinc-400 hidden sm:inline">{dateStr}</span>
                      <span className="font-semibold text-white">{timeStr}</span>
                    </div>
                    <div className="min-w-[90px]" />
                  </div>
                  <div className="flex items-center justify-center gap-3 px-4">
                    {NavArrow({ dir: -1 })}
                    <div className="flex-1 h-[70px] rounded-2xl border border-white/10 bg-zinc-900/40 flex flex-col items-center justify-center text-center">
                      <MusicIcon className="w-4 h-4 text-zinc-500 mb-1" />
                      <span className="text-[12px] font-medium text-zinc-300">Nada tocando agora</span>
                      <span className="text-[10px] text-zinc-500">Abra o Spotify ou outro app de música</span>
                    </div>
                    {NavArrow({ dir: 1 })}
                  </div>
                  {PaginationDots()}
                </>
              ) : !showLyrics ? (
                /* VISUAL PADRÃO IGUAL AO PRINT DE REFERÊNCIA (sem letra) */
                <>
                  <div className="flex items-center justify-between w-full px-4 pt-2.5 pb-1 text-[11px] font-medium text-zinc-400 select-none">
                    <span className="text-[10px] font-semibold text-emerald-400 flex items-center gap-1 min-w-[90px] truncate" title="Fonte de áudio detectada">
                      ● {mediaSource}
                    </span>

                    <div className="flex items-center gap-2 text-zinc-200">
                      {MascoteIlha()}
                      <span className="text-zinc-400 hidden sm:inline">{dateStr}</span>
                      <span className="font-semibold text-white">{timeStr}</span>
                    </div>

                    <div className="flex items-center justify-end min-w-[90px]">
                      {SoundWave({})}
                    </div>
                  </div>

                  <div className="flex items-center justify-between px-4 gap-3">
                    {renderCapa(false)}

                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-white truncate">{midia.titulo || 'Sem título'}</div>
                      <div className="text-[11px] text-zinc-400 truncate">{midia.artista || mediaSource}</div>
                    </div>

                    {NavArrow({ dir: 1 })}
                  </div>

                  {/* Barra de Progresso (clique para pular) */}
                  <div className="px-4 flex items-center gap-2.5 text-[10px] text-zinc-400 font-mono">
                    <span>{formatTime(trackProgress)}</span>
                    <div
                      onClick={(e) => {
                        if (trackDuration <= 0) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        buscarPosicao(ratio * trackDuration);
                      }}
                      className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden cursor-pointer"
                    >
                      <div
                        className="h-full bg-white rounded-full transition-all duration-300"
                        style={{ width: `${trackDuration > 0 ? (trackProgress / trackDuration) * 100 : 0}%` }}
                      />
                    </div>
                    <span>{trackDuration > 0 ? `-${formatTime(trackDuration - trackProgress)}` : '--:--'}</span>
                  </div>

                  {/* Controles + Botão Balãozinho para Letra */}
                  <div className="px-5 pb-1 flex items-center justify-between">
                    <button
                      onClick={() => setShowLyrics(true)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                      title="Mostrar letra sincronizada"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>

                    <div className="flex items-center gap-5">
                      <button onClick={() => controleMidia('prev')} className="text-zinc-300 hover:text-white transition-colors" title="Faixa anterior">
                        <SkipBack className="w-4 h-4 fill-current" />
                      </button>
                      <button
                        onClick={alternarReproducao}
                        className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform"
                        title={isPlaying ? 'Pausar' : 'Tocar'}
                      >
                        {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                      </button>
                      <button onClick={() => controleMidia('next')} className="text-zinc-300 hover:text-white transition-colors" title="Próxima faixa">
                        <SkipForward className="w-4 h-4 fill-current" />
                      </button>
                    </div>

                    <div className="w-6" />
                  </div>

                  {PaginationDots()}
                </>
              ) : (
                /* VISUAL EXPANDIDO COM LETRA — animação vertical estilo Apple Music no PC */
                <>
                  {/* Coluna Esquerda: Mini Player */}
                  <div className="w-[46%] flex flex-col justify-between h-full pr-3 border-r border-white/10">
                    <div className="flex items-center gap-2.5 pt-1">
                      {renderCapa(true)}
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-white truncate">{midia.titulo || 'Sem título'}</div>
                        <div className="text-[10px] text-zinc-400 truncate">{midia.artista} · {mediaSource}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[9px] text-zinc-400 font-mono">
                      <span>{formatTime(trackProgress)}</span>
                      <div
                        onClick={(e) => {
                          if (trackDuration <= 0) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          buscarPosicao(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * trackDuration);
                        }}
                        className="flex-1 h-1 bg-white/15 rounded-full overflow-hidden cursor-pointer"
                      >
                        <div
                          className="h-full bg-white rounded-full transition-all duration-300"
                          style={{ width: `${trackDuration > 0 ? (trackProgress / trackDuration) * 100 : 0}%` }}
                        />
                      </div>
                      <span>{trackDuration > 0 ? `-${formatTime(trackDuration - trackProgress)}` : '--:--'}</span>
                    </div>

                    <div className="flex items-center justify-between pb-1">
                      <button
                        onClick={() => setShowLyrics(false)}
                        className="p-1.5 rounded-lg bg-white/20 text-white hover:bg-white/30 transition-colors"
                        title="Ocultar letra"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex items-center gap-4">
                        <button onClick={() => controleMidia('prev')} className="hover:text-sky-300 transition-colors" title="Faixa anterior">
                          <SkipBack className="w-3.5 h-3.5 fill-current" />
                        </button>
                        <button onClick={alternarReproducao} className="hover:scale-110 transition-transform" title={isPlaying ? 'Pausar' : 'Tocar'}>
                          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                        </button>
                        <button onClick={() => controleMidia('next')} className="hover:text-sky-300 transition-colors" title="Próxima faixa">
                          <SkipForward className="w-3.5 h-3.5 fill-current" />
                        </button>
                      </div>
                      <div className="w-4" />
                    </div>
                  </div>

                  {/* Coluna Direita: letra com rolagem suave e foco na linha atual */}
                  <div className="flex-1 h-[126px] relative overflow-hidden pl-1 lyric-mask">
                    {letra === 'carregando' ? (
                      <div className="h-full flex items-center text-[12px] text-zinc-400 animate-pulse">Buscando letra...</div>
                    ) : linhasLetra.length === 0 ? (
                      <div className="h-full flex items-center text-[12px] text-zinc-400">Letra não encontrada para esta faixa.</div>
                    ) : letraSincronizada ? (
                      linhasLetra.map((l, i) => {
                        const dist = Math.abs(i - lyricIndex);
                        if (dist > 7) return null;
                        const atual = dist === 0;
                        const deslocamento = i * LINHA_H + (126 / 2 - lyricIndex * LINHA_H - LINHA_H / 2);
                        return (
                          <p
                            key={i}
                            onClick={() => buscarPosicao(l.t)}
                            className="absolute left-0 right-0 top-0 cursor-pointer origin-left flex items-center transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                            style={{
                              height: LINHA_H,
                              transform: `translateY(${deslocamento}px) scale(${atual ? 1 : 0.93})`,
                              opacity: atual ? 1 : Math.max(0.16, 0.55 - dist * 0.1),
                              filter: atual ? 'none' : `blur(${Math.min(2, dist * 0.5)}px)`,
                              transitionDelay: `${i >= lyricIndex ? Math.min(i - lyricIndex, 6) * 45 : 0}ms`,
                            }}
                          >
                            <span
                              className={`line-clamp-2 leading-[17px] ${
                                atual
                                  ? 'text-[14px] font-bold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.4)]'
                                  : 'text-[12px] font-semibold text-zinc-200'
                              }`}
                            >
                              {l.texto || '♪'}
                            </span>
                          </p>
                        );
                      })
                    ) : (
                      /* Letra sem tempos: rolagem manual */
                      <div className="h-full overflow-y-auto pr-1 space-y-1">
                        {linhasLetra.map((l, i) => (
                          <p key={i} className="text-[12px] font-medium text-zinc-200/80 leading-snug">{l.texto}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ----------------------------------------------------------------
              8. MODO FOCUS TIMER / POMODORO (Totalmente funcional)
          ---------------------------------------------------------------- */}
          {mode === 'focus' && (
            <div className="w-full h-full flex flex-col justify-between">
              {IslandHeader({ title: "Pomodoro" })}
              <div className="flex items-center justify-between px-3 gap-2">
                {NavArrow({ dir: -1 })}

                {/* Esquerda: Contador Principal */}
                <div className="flex-1 pr-3 border-r border-white/10">
                  <div className="text-[10px] text-zinc-400">Foco · {pomodoroRound} de 4</div>
                  <div
                    onClick={() => {
                      if (pomodoroRunning) return;
                      const opcoes = [15, 25, 45, 50];
                      const prox = opcoes[(opcoes.indexOf(pomodoroTotal / 60) + 1) % opcoes.length];
                      setPomodoroTotal(prox * 60);
                      setPomodoroSeconds(prox * 60);
                    }}
                    title={pomodoroRunning ? undefined : 'Clique para trocar a duração (15/25/45/50 min)'}
                    className={`text-2xl font-bold tracking-tight text-white leading-tight my-0.5 font-mono ${pomodoroRunning ? '' : 'cursor-pointer hover:text-purple-300'}`}
                  >
                    {formatTime(pomodoroSeconds)}
                  </div>
                  <div className="text-[10px] text-zinc-400 mb-1.5">
                    <span className="text-white font-medium">{fimStr}</span>{' '}
                    <span className="text-purple-400">{pomodoroRunning ? 'até concluir' : 'previsto se iniciar agora'}</span>
                  </div>
                  <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full transition-all duration-500"
                      style={{ width: `${((pomodoroTotal - pomodoroSeconds) / pomodoroTotal) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Direita: Timeline da Rodada com Ponto Brilhante */}
                <div className="flex-1 pl-2 flex flex-col justify-between gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">Esta rodada</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setPomodoroRunning(!pomodoroRunning)}
                        className="px-2.5 py-0.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-[10px] font-medium text-white transition-colors"
                      >
                        {pomodoroRunning ? 'Pausar' : pomodoroSeconds === pomodoroTotal ? 'Iniciar' : 'Continuar'}
                      </button>
                      <button
                        onClick={() => {
                          setPomodoroSeconds(pomodoroTotal);
                          setPomodoroRunning(false);
                        }}
                        className="p-1 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                        title="Reiniciar sessão"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>

                  {/* Barra de Sessões clicáveis */}
                  <div className="py-1">
                    <div className="relative flex items-center gap-1 h-2">
                      {[1, 2, 3, 4].map((step) => (
                        <button
                          key={step}
                          onClick={() => setPomodoroRound(step)}
                          className={`flex-1 h-1.5 rounded-full relative transition-colors ${
                            step < pomodoroRound
                              ? 'bg-purple-500'
                              : step === pomodoroRound
                              ? 'bg-purple-500/40'
                              : 'bg-zinc-800 hover:bg-zinc-700'
                          }`}
                        >
                          {step === pomodoroRound && (
                            <span className="absolute left-1/3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_10px_#c084fc,0_0_4px_#fff]" />
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-between text-[9px] text-zinc-500 mt-1 px-1">
                      {[1, 2, 3, 4].map((n) => (
                        <span key={n} className={pomodoroRound === n ? 'text-zinc-200 font-bold' : ''}>
                          {n}
                        </span>
                      ))}
                      <span>Longa</span>
                    </div>
                  </div>

                  <div className="text-[9px] text-zinc-500">{Math.round((pomodoroTotal * 4) / 60)} min · 4 sessões</div>
                </div>

                {NavArrow({ dir: 1 })}
              </div>
              {PaginationDots()}
            </div>
          )}

          {/* ----------------------------------------------------------------
              9. MODO WATER REMINDER (Lembrete de Água com Meta Ajustável)
          ---------------------------------------------------------------- */}
          {mode === 'water' && (
            <div className="w-full h-full flex flex-col justify-between">
              <div className="flex items-center justify-between w-full px-4 pt-2.5 pb-1 text-[11px] font-medium text-zinc-400">
                <div>
                  <span className="text-white font-semibold">Lembrete </span>
                  <span className="text-sky-400 font-semibold">Água</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-200">
                  {MascoteIlha()}
                  <span className="text-zinc-400 hidden sm:inline">{dateStr}</span>
                  <span className="font-semibold text-white">{timeStr}</span>
                </div>
                {SoundWave({})}
              </div>

              <div className="flex items-center justify-between px-3 gap-2">
                {NavArrow({ dir: -1 })}

                {/* Esquerda: Meta e Botão Beber */}
                <div className="flex-1 pr-3 border-r border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-white">{waterIntake.toFixed(2)}</span>
                      <span className="text-[11px] text-zinc-400">/ {waterGoal.toFixed(1)} L</span>
                    </div>
                    <button
                      onClick={() => setWaterReminderEnabled(!waterReminderEnabled)}
                      title="Ativar/Desativar lembretes"
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center ${
                        waterReminderEnabled ? 'bg-sky-500 justify-end' : 'bg-zinc-700 justify-start'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-white flex items-center justify-center">
                        <Droplets className="w-2.5 h-2.5 text-sky-500" />
                      </span>
                    </button>
                  </div>

                  <div className="text-[10px] text-zinc-400 mt-0.5">
                    Hoje ·{' '}
                    <span className="text-sky-400 font-semibold">
                      {Math.min(100, Math.round((waterIntake / waterGoal) * 100))}%
                    </span>{' '}
                    · {waterIntake >= waterGoal ? 'Meta atingida!' : 'Continue hidratado'}
                  </div>

                  <div className="w-full h-1 bg-zinc-800 rounded-full my-1.5 overflow-hidden">
                    <div
                      className="h-full bg-sky-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (waterIntake / waterGoal) * 100)}%` }}
                    />
                  </div>

                  {showWaterSettings ? (
                    <div className="flex items-center justify-between gap-1 text-[9px]">
                      <span className="text-zinc-400">Meta:</span>
                      {[1.5, 2.0, 2.5, 3.0].map((g) => (
                        <button
                          key={g}
                          onClick={() => {
                            setWaterGoal(g);
                            setShowWaterSettings(false);
                          }}
                          className={`px-1.5 py-0.5 rounded ${
                            waterGoal === g ? 'bg-sky-500 text-black font-bold' : 'bg-zinc-800 text-zinc-300'
                          }`}
                        >
                          {g}L
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => registrarAgua(COPO_ML)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 text-sky-300 text-[10px] font-medium transition-colors"
                      >
                        <Droplets className="w-3 h-3" /> +250ml
                      </button>
                      <button
                        onClick={() => setShowWaterSettings(true)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-medium"
                      >
                        <Sliders className="w-3 h-3" /> Ajustes
                      </button>
                    </div>
                  )}
                </div>

                {/* Direita: Gráfico por Hora (histórico real de hoje) */}
                <div className="w-[155px] pl-1 flex flex-col justify-between">
                  <div className="flex items-end justify-between h-14 gap-1.5 pt-2">
                    {barrasAgua.map((bar) => (
                      <div key={bar.hora} className="flex-1 h-full bg-zinc-900 rounded-sm flex items-end overflow-hidden" title={`${bar.hora}h · ${bar.ml} ml`}>
                        <div
                          className="w-full bg-gradient-to-t from-sky-600 to-sky-400 rounded-sm transition-all"
                          style={{ height: `${Math.min(100, (bar.ml / escalaAgua) * 100)}%` }}
                        />
                      </div>
                    ))}
                    <div className="flex flex-col justify-between h-full text-[8px] text-zinc-500 pl-0.5">
                      <span>{escalaAgua}</span>
                      <span>{escalaAgua / 2}</span>
                      <span>0 ml</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-[8px] text-zinc-500 pr-6 mt-1">
                    <span>{barrasAgua[0].hora}</span>
                    <span>{barrasAgua[3].hora}</span>
                    <span>{barrasAgua[6].hora}</span>
                  </div>
                </div>

                {NavArrow({ dir: 1 })}
              </div>
              {PaginationDots()}
            </div>
          )}

          {/* ----------------------------------------------------------------
              10. MODO SHELF / ARQUIVOS (Sem print estático + Brilho colorido serrilhado)
          ---------------------------------------------------------------- */}
          {mode === 'shelf' && (
            <div className="w-full h-full flex flex-col justify-between">
              <div className="flex items-center justify-between w-full px-4 pt-2.5 pb-1 text-[11px] font-medium text-zinc-400">
                <span className="font-semibold text-white">Arquivos</span>
                <div className="flex items-center gap-2 text-zinc-200">
                  {MascoteIlha()}
                  <span className="text-zinc-400 hidden sm:inline">{dateStr}</span>
                  <span className="font-semibold text-white">{timeStr}</span>
                </div>
                <div className="flex items-center bg-zinc-900 rounded-full p-0.5 border border-white/10">
                  <button
                    className="px-2 py-0.5 rounded-full bg-sky-500/30 text-sky-300 border border-sky-400/40"
                    title="Arquivos"
                  >
                    <Inbox className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setMode('clipboard')}
                    className="px-2 py-0.5 rounded-full text-zinc-400 hover:text-white"
                    title="Área de Transferência"
                  >
                    <ClipboardList className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between px-3 gap-2 flex-1">
                {NavArrow({ dir: -1 })}

                {/* Wrapper com borda serrilhada brilhante colorida */}
                <div
                  className={`flex-1 h-[96px] rounded-2xl p-[1.5px] transition-all ${
                    isDraggingOver
                      ? 'shelf-drop-glow shadow-[0_0_25px_rgba(56,189,248,0.65)] scale-[1.01]'
                      : 'bg-transparent'
                  }`}
                >
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingOver(true);
                    }}
                    onDragLeave={() => setIsDraggingOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`w-full h-full rounded-[15px] border border-dashed transition-all cursor-pointer flex items-center justify-center relative px-3 overflow-hidden ${
                      isDraggingOver
                        ? 'border-white/90 bg-[#081224]/95'
                        : 'border-zinc-700 bg-zinc-900/50 hover:border-sky-400/60'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (!e.target.files) return;
                        processDroppedFiles(Array.from(e.target.files));
                      }}
                    />

                    {shelfFiles.length === 0 ? (
                      <div className="flex flex-col items-center text-center">
                        <Upload
                          className={`w-4 h-4 mb-1 transition-colors ${
                            isDraggingOver ? 'text-sky-400 animate-bounce' : 'text-zinc-400'
                          }`}
                        />
                        <span className="text-[11px] font-medium text-zinc-200">
                          {isDraggingOver ? 'Solte para guardar na ilha!' : 'Solte arquivos aqui'}
                        </span>
                        <span className="text-[9px] text-zinc-500">
                          Clique para adicionar · clique num arquivo para abrir a pasta
                        </span>
                      </div>
                    ) : (
                      <div className="w-full flex items-center gap-2 overflow-x-auto py-1">
                        {shelfFiles.map((file) => (
                          <div
                            key={file.id}
                            title={file.path ? 'Abrir a pasta do arquivo' : file.name}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (file.path) void revelarArquivo(file.path);
                            }}
                            className="group relative w-[86px] h-[74px] shrink-0 rounded-xl bg-zinc-800/90 border border-white/10 hover:border-sky-400/50 p-2 flex flex-col justify-between transition-all"
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShelfFiles((prev) => prev.filter((f) => f.id !== file.id));
                              }}
                              className="opacity-0 group-hover:opacity-100 absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center transition-opacity"
                              title="Remover arquivo"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                            <div className="w-6 h-6 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
                              {file.type === 'image' ? (
                                <ImageIcon className="w-3.5 h-3.5" />
                              ) : file.type === 'code' ? (
                                <Code2 className="w-3.5 h-3.5" />
                              ) : (
                                <FileText className="w-3.5 h-3.5" />
                              )}
                            </div>
                            <div>
                              <div className="text-[9px] font-medium text-white truncate">{file.name}</div>
                              <div className="text-[8px] text-zinc-400">{file.size}</div>
                            </div>
                          </div>
                        ))}
                        <div className="w-[64px] h-[74px] shrink-0 rounded-xl border border-dashed border-zinc-700 hover:border-sky-400 flex flex-col items-center justify-center text-zinc-400 hover:text-sky-300">
                          <Plus className="w-4 h-4" />
                          <span className="text-[8px] mt-0.5">Mais</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {NavArrow({ dir: 1 })}
              </div>
              {PaginationDots()}
            </div>
          )}

          {/* ----------------------------------------------------------------
              11. MODO CLIPBOARD (Histórico de Área de Transferência)
          ---------------------------------------------------------------- */}
          {mode === 'clipboard' && (
            <div className="w-full h-full flex flex-col justify-between">
              <div className="flex items-center justify-between w-full px-4 pt-2.5 pb-1 text-[11px] font-medium text-zinc-400">
                <span className="font-semibold text-white">Clipboard</span>
                <div className="flex items-center gap-2 text-zinc-200">
                  {MascoteIlha()}
                  <span className="text-zinc-400 hidden sm:inline">{dateStr}</span>
                  <span className="font-semibold text-white">{timeStr}</span>
                </div>
                <div className="flex items-center bg-zinc-900 rounded-full p-0.5 border border-white/10">
                  <button
                    onClick={() => setMode('shelf')}
                    className="px-2 py-0.5 rounded-full text-zinc-400 hover:text-white"
                    title="Arquivos"
                  >
                    <Inbox className="w-3 h-3" />
                  </button>
                  <button
                    className="px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/40"
                    title="Arquivos copiados"
                  >
                    <ClipboardList className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between px-3 gap-2 flex-1 min-h-0">
                {NavArrow({ dir: -1 })}

                {clipFiles.length === 0 ? (
                  <div className="flex-1 h-[82px] rounded-2xl border border-dashed border-white/10 bg-zinc-900/40 flex flex-col items-center justify-center text-center px-3">
                    <span className="text-[11px] font-medium text-zinc-300">Nenhum arquivo copiado</span>
                    <span className="text-[9px] text-zinc-500">Copie um arquivo (Ctrl+C) no Explorer e ele aparece aqui</span>
                  </div>
                ) : (
                  <div className="flex-1 min-w-0 flex gap-2 overflow-x-auto py-1">
                    {clipFiles.map((item, idx) => {
                      const tipo = tipoDoArquivo(item.name);
                      return (
                        <div
                          key={item.id}
                          onClick={() => void revelarArquivo(item.path)}
                          title={item.path}
                          className={`group relative w-[104px] h-[82px] shrink-0 rounded-xl p-2 text-left flex flex-col justify-between cursor-pointer transition-all border ${
                            copiedId === item.id
                              ? 'bg-emerald-500/20 border-emerald-400'
                              : idx === 0
                              ? 'bg-zinc-900/90 border-indigo-500/50 hover:border-indigo-400'
                              : 'bg-zinc-900/70 border-white/5 hover:border-white/20'
                          }`}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCopyPath(item.id, item.path);
                            }}
                            className="opacity-0 group-hover:opacity-100 absolute top-1 right-1 p-0.5 rounded bg-white/10 hover:bg-white/20 text-zinc-300 transition-opacity"
                            title="Copiar caminho"
                          >
                            <Copy className="w-2.5 h-2.5" />
                          </button>
                          <div className="w-5 h-5 rounded-md bg-indigo-500/20 text-indigo-300 flex items-center justify-center">
                            {item.size === 'Pasta' ? <Folder className="w-3 h-3" /> : tipo === 'image' ? <ImageIcon className="w-3 h-3" /> : tipo === 'code' ? <Code2 className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                          </div>
                          <p className="text-[10px] text-zinc-200 line-clamp-2 leading-snug break-all">
                            {copiedId === item.id ? 'Caminho copiado!' : item.name}
                          </p>
                          <span className="text-[8px] text-zinc-500">{item.size} · {haQuantoTempo(item.copiedAt, agora)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {NavArrow({ dir: 1 })}
              </div>

              <div className="flex items-center justify-between px-10">
                <span className="text-[9px] text-zinc-500">{clipFiles.length} {clipFiles.length === 1 ? 'arquivo' : 'arquivos'} · clique para abrir a pasta</span>
                {PaginationDots()}
                <button
                  onClick={() => setClipFiles([])}
                  className="text-[9px] text-zinc-500 hover:text-rose-400 transition-colors"
                >
                  Limpar
                </button>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------------------
              12. MODO TO-DO LIST (Tarefas do Dia - Completamente interativo)
          ---------------------------------------------------------------- */}
          {mode === 'todo' && (
            <div className="w-full h-full flex flex-col justify-between">
              <div className="flex items-center justify-between w-full px-4 pt-2.5 pb-1 text-[11px] font-medium text-zinc-400">
                <div>
                  <span className="text-white font-semibold">Lista de </span>
                  <span className="text-emerald-400 font-semibold">Tarefas</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-200">
                  {MascoteIlha()}
                  <span className="text-zinc-400 hidden sm:inline">{dateStr}</span>
                  <span className="font-semibold text-white">{timeStr}</span>
                </div>
                {SoundWave({})}
              </div>

              <div className="flex items-center justify-between px-3 gap-2">
                {NavArrow({ dir: -1 })}

                {/* Esquerda: Resumo e Botões */}
                <div className="w-[38%] flex flex-col justify-between pr-2">
                  <div>
                    <div className="text-2xl font-bold text-white leading-none">
                      {completedTodos}/{todos.length}
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-1">Concluídas hoje</div>
                  </div>

                  {isAddingTodo ? (
                    <form onSubmit={addTodo} className="mt-2 flex gap-1">
                      <input
                        autoFocus
                        value={newTodoText}
                        onChange={(e) => setNewTodoText(e.target.value)}
                        onBlur={() => !newTodoText && setIsAddingTodo(false)}
                        placeholder="Nova tarefa..."
                        className="w-full bg-zinc-900 border border-emerald-500/50 rounded-lg px-2 py-1 text-[10px] text-white outline-none"
                      />
                    </form>
                  ) : (
                    <div className="flex items-center gap-1.5 mt-2">
                      <button
                        onClick={() => setIsAddingTodo(true)}
                        className="flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-800 hover:bg-zinc-700 text-[9px] font-medium text-zinc-200"
                      >
                        <Plus className="w-2.5 h-2.5" /> Nova
                      </button>
                      <button
                        onClick={() => setTodos((prev) => prev.filter((t) => !t.done))}
                        className="flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-800 hover:bg-zinc-700 text-[9px] font-medium text-zinc-200"
                        title="Remover tarefas concluídas"
                      >
                        <Trash2 className="w-2.5 h-2.5" /> Limpar
                      </button>
                    </div>
                  )}
                </div>

                {/* Direita: Lista Rolável de Tarefas com Edição */}
                <div className="flex-1 max-h-[86px] overflow-y-auto space-y-1.5 pr-1">
                  {todos.map((todo) => (
                    <div
                      key={todo.id}
                      onClick={() => toggleTodo(todo.id)}
                      className={`group flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg cursor-pointer transition-colors border ${
                        todo.done
                          ? 'bg-emerald-950/60 border-emerald-500/25 text-zinc-300'
                          : 'bg-zinc-900/90 border-white/5 text-white hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 ${
                            todo.done ? 'bg-emerald-500 text-black' : 'border border-zinc-500'
                          }`}
                        >
                          {todo.done && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </span>
                        {editingTodoId === todo.id ? (
                          <input
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            value={editingTodoText}
                            onChange={(e) => setEditingTodoText(e.target.value)}
                            onBlur={() => saveEditTodo(todo.id)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditTodo(todo.id)}
                            className="bg-zinc-800 text-[10px] text-white px-1 rounded outline-none w-full"
                          />
                        ) : (
                          <span className={`text-[10px] truncate ${todo.done ? 'line-through text-zinc-400' : ''}`}>
                            {todo.text}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTodoId(todo.id);
                          setEditingTodoText(todo.text);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-white p-0.5"
                        title="Editar tarefa"
                      >
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {NavArrow({ dir: 1 })}
              </div>

              {PaginationDots()}
            </div>
          )}

          {/* ----------------------------------------------------------------
              14. APROVAÇÃO PENDENTE (Claude, Gemini...) com Aceitar / Negar
          ---------------------------------------------------------------- */}
          {mode === 'aprovacao' && pendencias[0] && (
            <div className="w-full h-full flex items-center justify-between px-4 gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Mascote estado="pending" tamanho={40} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-white truncate">{pendencias[0].app}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 shrink-0">Pendente</span>
                    {pendencias.length > 1 && (
                      <span className="text-[9px] text-zinc-500 shrink-0">+{pendencias.length - 1}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 truncate max-w-[190px]">{pendencias[0].mensagem}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => decidirAprovacao(false)}
                  className="px-2.5 py-1 rounded-full bg-rose-500/15 hover:bg-rose-500/30 border border-rose-400/30 text-rose-200 text-[11px] font-medium transition-colors"
                >
                  Negar
                </button>
                <button
                  onClick={() => decidirAprovacao(true)}
                  className="px-2.5 py-1 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-semibold transition-colors"
                >
                  Aceitar
                </button>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------------------
              15. TIMER (design da ilha com dígitos que rolam, estilo iPhone)
          ---------------------------------------------------------------- */}
          {mode === 'timer' && (
            <div className="w-full h-full flex flex-col justify-between px-3 py-2">
              <div className="flex items-center justify-between px-1 text-[10px] font-medium text-zinc-400">
                <span className="font-semibold text-white">Timer</span>
                <span>{pomodoroRunning ? `termina às ${fimStr}` : 'pronto para iniciar'}</span>
                <span className="font-semibold text-white">{timeStr}</span>
              </div>

              {/* Dígitos que caem de cima para baixo (estilo iPhone) */}
              <div className="flex items-center justify-between gap-2">
                {NavArrow({ dir: -1 })}
                <RolagemNumero
                  texto={formatTime(pomodoroSeconds)}
                  className="text-[44px] font-semibold text-white leading-none gap-[0.16em]"
                />
                {NavArrow({ dir: 1 })}
              </div>

              {/* Botão principal em pílula clara + reiniciar */}
              <div className="flex items-center justify-center gap-3">
                <div className="w-8" />
                <button
                  onClick={() => setPomodoroRunning(!pomodoroRunning)}
                  title={pomodoroRunning ? 'Pausar' : 'Iniciar'}
                  className="h-8 min-w-[104px] px-4 rounded-full bg-[#d4e4f1] hover:bg-[#e6f0f8] text-[#0b1220] flex items-center justify-center gap-1.5 text-[12px] font-semibold active:scale-95 transition-all"
                >
                  {pomodoroRunning ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  {pomodoroRunning ? 'Pausar' : pomodoroSeconds === pomodoroTotal ? 'Iniciar' : 'Continuar'}
                </button>
                <button
                  onClick={() => {
                    setPomodoroSeconds(pomodoroTotal);
                    setPomodoroRunning(false);
                  }}
                  title="Reiniciar"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 active:scale-90 transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Durações rápidas */}
              <div className="flex items-center justify-center gap-4">
                {[5, 15, 25, 50].map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      if (pomodoroRunning) return;
                      setPomodoroTotal(m * 60);
                      setPomodoroSeconds(m * 60);
                    }}
                    className={`text-[11px] transition-colors ${
                      pomodoroTotal === m * 60
                        ? 'text-white font-semibold'
                        : 'text-zinc-500 hover:text-zinc-300'
                    } ${pomodoroRunning ? 'cursor-default' : ''}`}
                  >
                    {m}m
                  </button>
                ))}
              </div>

              {PaginationDots()}
            </div>
          )}

          {mode === 'settings' && (
            <div className="w-full h-full flex flex-col justify-between">
              <div className="flex items-center justify-between w-full px-4 pt-2.5 pb-1 text-[11px] font-medium text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <SettingsIcon className="w-3.5 h-3.5 text-zinc-300" />
                  <span className="font-semibold text-white">Configurações</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-200">
                  {MascoteIlha()}
                  <span className="text-zinc-400 hidden sm:inline">{dateStr}</span>
                  <span className="font-semibold text-white">{timeStr}</span>
                </div>
                <div className="min-w-[90px]" />
              </div>

              <div className="flex items-center justify-between px-3 gap-2 flex-1 min-h-0">
                {NavArrow({ dir: -1 })}

                <div className="flex-1 h-full overflow-y-auto pr-1 space-y-2 py-1 text-[10px]">
                  {/* Gemini */}
                  <div>
                    <div className="flex items-center justify-between text-zinc-400 mb-0.5">
                      <span className="flex items-center gap-1"><KeyRound className="w-2.5 h-2.5" /> Chave do Gemini</span>
                      <span className={geminiMsg.includes('✓') ? 'text-emerald-400' : 'text-zinc-500'}>{geminiMsg}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={chaveGemini}
                        onChange={(e) => setChaveGemini(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void salvarGemini()}
                        placeholder="Cole a chave da API (AIza...)"
                        className="flex-1 min-w-0 bg-zinc-900 border border-white/10 focus:border-sky-400/60 rounded-lg px-2 py-1 text-[10px] text-white placeholder-zinc-600 outline-none"
                      />
                      <button
                        onClick={() => void salvarGemini()}
                        disabled={geminiBusy}
                        className="px-2.5 py-1 rounded-lg bg-sky-500/25 hover:bg-sky-500/40 border border-sky-400/30 text-sky-200 font-medium flex items-center gap-1 disabled:opacity-60"
                      >
                        {geminiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Salvar
                      </button>
                    </div>
                  </div>

                  {/* Spotify */}
                  <div>
                    <div className="flex items-center justify-between text-zinc-400 mb-0.5">
                      <span className="flex items-center gap-1">
                        <Link2 className="w-2.5 h-2.5" /> Spotify ·{' '}
                        <span className={spotifyVinculado ? 'text-emerald-400' : 'text-zinc-500'}>
                          {spotifyVinculado ? 'vinculado' : 'não vinculado'}
                        </span>
                      </span>
                      <span className="text-zinc-500 truncate max-w-[210px]" title={spotifyMsg}>{spotifyMsg}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={spotifyClientId}
                        onChange={(e) => setSpotifyClientId(e.target.value)}
                        placeholder="Client ID do app no Spotify Developer"
                        className="flex-1 min-w-0 bg-zinc-900 border border-white/10 focus:border-emerald-400/60 rounded-lg px-2 py-1 text-[10px] text-white placeholder-zinc-600 outline-none"
                      />
                      {spotifyVinculado ? (
                        <button
                          onClick={desvincular}
                          className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-rose-500/30 border border-white/10 text-zinc-300 font-medium flex items-center gap-1"
                        >
                          <Unlink className="w-3 h-3" /> Desvincular
                        </button>
                      ) : (
                        <button
                          onClick={() => void vincular()}
                          disabled={spotifyBusy}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400/30 text-emerald-200 font-medium flex items-center gap-1 disabled:opacity-60"
                        >
                          {spotifyBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />} Vincular
                        </button>
                      )}
                    </div>
                    {!spotifyVinculado && (
                      <div className="text-[8px] text-zinc-600 mt-0.5 select-text">Redirect URI no painel do Spotify: {REDIRECT_URI}</div>
                    )}
                  </div>

                  {/* Formato da ilha + atalho */}
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-zinc-400 mb-0.5">Formato da ilha</div>
                      <div className="flex items-center bg-zinc-900 rounded-full p-0.5 border border-white/10">
                        {([
                          { id: 'notch', label: 'Notch' },
                          { id: 'pupila', label: 'Pupila flutuante' },
                        ] as { id: FormatoIlha; label: string }[]).map((f) => (
                          <button
                            key={f.id}
                            onClick={() => escolherFormato(f.id)}
                            className={`px-2.5 py-0.5 rounded-full transition-colors ${
                              formato === f.id ? 'bg-white text-black font-semibold' : 'text-zinc-400 hover:text-white'
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="text-right max-w-[230px]">
                      <div className="text-zinc-400 mb-0.5">
                        Atalho para mostrar · <span className="text-zinc-200 font-medium">{atalhoRotulo}</span>
                      </div>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={gravandoAtalho ? undefined : gravarAtalho}
                          className={`px-2.5 py-0.5 rounded-full border transition-colors ${
                            gravandoAtalho
                              ? 'bg-amber-500/25 border-amber-400/50 text-amber-200 animate-pulse'
                              : 'bg-zinc-800 hover:bg-zinc-700 border-white/10 text-zinc-200'
                          }`}
                        >
                          {gravandoAtalho ? 'Gravando…' : 'Gravar'}
                        </button>
                        <button
                          onClick={() => {
                            window.auraAtalhoDefinir?.([]);
                            setAtalhoRotulo('Nenhum');
                            setAtalhoMsg('');
                          }}
                          className="p-1 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                          title="Remover atalho"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                      {atalhoMsg && (
                        <div className={`mt-1 text-[9px] leading-snug ${gravandoAtalho ? 'text-amber-300' : 'text-zinc-400'}`}>
                          {atalhoMsg}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {NavArrow({ dir: 1 })}
              </div>

              {PaginationDots()}
            </div>
          )}

          {/* ----------------------------------------------------------------
              13. PÁGINA HOME / WIDGETS (Exibe apenas atividades ativas/pendentes)
          ---------------------------------------------------------------- */}
          {mode === 'widgets' && (
            <div className="w-full h-full flex flex-col justify-between px-4 py-3">
              {/* Topo */}
              <div className="flex items-center justify-between text-[11px]">
                <div className="w-8" />
                <div className="flex items-center gap-2">
                  <Mascote estado={reacao ?? estadoMascote} tamanho={24} />
                  <span className="text-zinc-400">{dateStr}</span>
                  <span
                    onClick={(e) => { e.stopPropagation(); setMode('timer'); }}
                    title="Abrir timer"
                    className="font-bold text-white cursor-pointer hover:text-sky-300 transition-colors"
                  >
                    {timeStr}
                  </span>
                </div>
                <button
                  onClick={() => setMode('closed')}
                  className="text-zinc-400 hover:text-white p-1"
                  title="Minimizar Ilha"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </div>

              {/* Área Central Dinâmica: Atividades Pendentes/Ativas ou Mensagem Vazia */}
              {activeHomeWidgets.length === 0 ? (
                <div className="h-[126px] my-1.5 rounded-2xl border border-white/10 bg-zinc-900/40 flex flex-col items-center justify-center text-center px-4">
                  <span className="text-xs font-medium text-zinc-400">Nenhuma atividade ativa</span>
                  <span className="text-[10px] text-zinc-600 mt-1">
                    Inicie uma música, timer de foco ou tarefa para acompanhar aqui
                  </span>
                </div>
              ) : (
                <div
                  className={`grid gap-2.5 my-1.5 ${
                    activeHomeWidgets.length === 1
                      ? 'grid-cols-1'
                      : activeHomeWidgets.length === 2
                      ? 'grid-cols-2'
                      : 'grid-cols-3'
                  }`}
                >
                  {activeHomeWidgets.map((w) => (
                    <div
                      key={w.id}
                      onClick={w.onClick}
                      className={`h-[126px] rounded-2xl p-3 flex flex-col justify-between cursor-pointer border ${w.border} transition-all relative overflow-hidden`}
                      style={{ background: w.gradient }}
                    >
                      <div className="flex items-start justify-between">
                        <span className={`text-[11px] font-medium ${w.labelColor}`}>{w.label}</span>
                        {w.isMusic ? (
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-400 to-rose-700 flex items-center justify-center shadow-md border border-white/20">
                            {w.icon}
                          </div>
                        ) : w.isFocus ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPomodoroRunning(false);
                            }}
                            title="Parar foco"
                            className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center shadow hover:scale-105 transition-transform"
                          >
                            <span className="w-2.5 h-2.5 rounded-[2px] bg-black" />
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (w.id === 'ai') setAiSystemTaskLabel(null);
                            }}
                            title="Dispensar"
                            className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center shadow hover:scale-105 transition-transform"
                          >
                            {w.icon}
                          </button>
                        )}
                      </div>

                      {w.isMusic ? (
                        <div className="flex items-end justify-between gap-1">
                          <div className="min-w-0">
                            <div className="text-[13px] font-bold text-white truncate">{w.title}</div>
                            <div className={`text-[10px] ${w.subtitleColor}`}>{w.subtitle}</div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isPlaying) alternarReproducao();
                            }}
                            title="Pausar música"
                            className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center shrink-0 hover:scale-105 transition-transform"
                          >
                            <Pause className="w-3.5 h-3.5 fill-current" />
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div className="text-xl font-bold text-white leading-tight font-mono">{w.title}</div>
                          <div className={`text-[10px] truncate ${w.subtitleColor}`}>{w.subtitle}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Ícones em páginas com efeito de vidro: arraste ou toque nas bolinhas para trocar de página */}
              <div className="flex items-center gap-2 pt-1">
                <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
                  <div
                    onPointerDown={aoPressionarPagina}
                    onPointerMove={aoMoverPagina}
                    onPointerUp={aoSoltarPagina}
                    onPointerCancel={aoSoltarPagina}
                    onClickCapture={(e) => {
                      if (paginaMovidaRef.current) {
                        e.stopPropagation();
                        e.preventDefault();
                      }
                    }}
                    className="glass-expo w-full rounded-[20px] p-1.5 touch-pan-y select-none cursor-grab active:cursor-grabbing"
                  >
                    <div
                      className="flex"
                      style={{
                        transform: `translateX(calc(${-paginaHome * 100}% + ${arrasteHome}px))`,
                        transition: arrasteHome === 0 ? 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
                      }}
                    >
                      {PAGINAS_HOME.map((pagina, idx) => (
                        <div key={idx} className="w-full shrink-0 flex items-center justify-around gap-1">
                          {pagina.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => setMode(item.id)}
                              title={item.titulo}
                              className="glass-expo w-11 h-11 rounded-[15px] flex items-center justify-center text-zinc-100 hover:scale-110 active:scale-90 transition-transform duration-200"
                            >
                              {item.icone}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {PAGINAS_HOME.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={() => setPaginaHome(idx)}
                        aria-label={`Página ${idx + 1}`}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          paginaHome === idx ? 'w-4 bg-white' : 'w-1.5 bg-zinc-600 hover:bg-zinc-400'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <button
                  onClick={alternarReproducao}
                  className="text-zinc-400 hover:text-white p-1"
                  title="Tocar / pausar a mídia"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
