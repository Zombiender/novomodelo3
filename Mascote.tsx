/**
 * Mascote Cubee (port do cubee_neo_avatar_interativo.html para React).
 * Desenha o cubo 3D com visor OLED num canvas e troca a expressão conforme o estado da ilha.
 * Desenha numa "área de palco" de 270 unidades e escala para o tamanho pedido.
 */
import { useEffect, useRef } from 'react';

export type EstadoMascote =
  | 'idle' | 'listening' | 'thinking' | 'working' | 'success' | 'error'
  | 'permission' | 'poked' | 'dizzy' | 'dragged' | 'sleeping'
  | 'notification' | 'swallow' | 'dancing' | 'seasonal' | 'pending' | 'denied';

const PALCO = 270;
const CAIXA = 191.49921875;
const PROFUNDIDADE = 171.95848214285726;
const ARREDONDAMENTO = 0.73265625;
const DESLOC_OLHOS_Y = -0.07310734785961104;
const CANTO = (CAIXA / 2) * ARREDONDAMENTO;
const RAIO = CAIXA * 0.24;
const DESLOC_PROFUNDIDADE = (PROFUNDIDADE / CAIXA) * 11;
const ESPACO_OLHOS = CAIXA * 0.165;

const TEMA = { escuro: '#0b1536', medio: '#1e1b4b', roxo: '#6d28d9', luz: '#a855f7', olho: '#f3e8ff' };

// Expressões que voltam sozinhas ao estado definido pela ilha, depois de N segundos
const DURACAO: Partial<Record<EstadoMascote, number>> = {
  poked: 0.5, dizzy: 2.2, notification: 2.5, swallow: 1.7, denied: 1.8, success: 2.4,
};
const SEM_PISCAR: EstadoMascote[] = ['sleeping', 'dizzy', 'poked', 'success', 'pending'];
const COM_PATAS: EstadoMascote[] = ['working', 'permission', 'dragged', 'dancing'];

type Ctx = CanvasRenderingContext2D;

function squircle(ctx: Ctx, x: number, y: number, largura: number, altura: number, raio: number) {
  const w = largura / 2;
  const h = altura / 2;
  const r = Math.min(raio, w, h);
  ctx.beginPath();
  ctx.moveTo(x - w + r, y - h);
  ctx.lineTo(x + w - r, y - h);
  ctx.quadraticCurveTo(x + w, y - h, x + w, y - h + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x - w + r, y + h);
  ctx.quadraticCurveTo(x - w, y + h, x - w, y + h - r);
  ctx.lineTo(x - w, y - h + r);
  ctx.quadraticCurveTo(x - w, y - h, x - w + r, y - h);
  ctx.closePath();
}

interface Anim {
  olhoX: number; olhoY: number;
  rostoX: number; rostoY: number;
  escalaX: number; escalaY: number;
  inclinacao: number; deslX: number; deslY: number;
  olhoAberto: number; olhoEscala: number;
  boca: number; pataE: number; pataD: number;
}

const ANIM_INICIAL: Anim = {
  olhoX: 0, olhoY: 0, rostoX: 0, rostoY: 0, escalaX: 1, escalaY: 1,
  inclinacao: 0, deslX: 0, deslY: 0, olhoAberto: 1, olhoEscala: 1,
  boca: 0, pataE: 0, pataD: 0,
};

export function Mascote({ estado, tamanho = 28 }: { estado: EstadoMascote; tamanho?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const alvoRef = useRef<EstadoMascote>(estado);
  const atualRef = useRef<EstadoMascote>(estado);
  const tempoEstadoRef = useRef(0);
  const proximaPiscadaRef = useRef(2.5);
  const ponteiroRef = useRef({ x: 0, y: 0 });
  const animRef = useRef<Anim>({ ...ANIM_INICIAL });

  // Mudança vinda da ilha: troca a expressão e reinicia a contagem
  useEffect(() => {
    alvoRef.current = estado;
    atualRef.current = estado;
    tempoEstadoRef.current = 0;
  }, [estado]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const escala = (tamanho / PALCO) * dpr;
    canvas.width = Math.round(tamanho * dpr);
    canvas.height = Math.round(tamanho * dpr);
    ponteiroRef.current = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    const aoMover = (e: PointerEvent) => {
      ponteiroRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', aoMover);

    let quadro = 0;
    let ultimo = performance.now();

    const desenhar = (agora: number) => {
      const dt = Math.min((agora - ultimo) / 1000, 0.05);
      ultimo = agora;
      const t = agora / 1000;
      tempoEstadoRef.current += dt;
      const tempo = tempoEstadoRef.current;

      // Expressões transitórias voltam ao estado da ilha
      const limite = DURACAO[atualRef.current];
      if (limite !== undefined && tempo > limite) {
        const base = alvoRef.current;
        atualRef.current = DURACAO[base] !== undefined ? 'idle' : base;
        tempoEstadoRef.current = 0;
      }
      const a = atualRef.current;
      const anim = animRef.current;

      // Olhar para o ponteiro
      const rect = canvas.getBoundingClientRect();
      const dx = ponteiroRef.current.x - (rect.left + rect.width / 2);
      const dy = ponteiroRef.current.y - (rect.top + rect.height / 2);
      const forca = Math.tanh(Math.hypot(dx, dy) / 180);
      const angulo = Math.atan2(dy, dx);

      let tOlhoX = Math.cos(angulo) * forca * (RAIO * 0.28);
      let tOlhoY = Math.sin(angulo) * forca * (RAIO * 0.22);
      const respira = Math.sin(t * 1.8);
      let tEscalaX = 1 - respira * 0.012;
      let tEscalaY = 1 + respira * 0.018;
      let tDeslX = 0;
      let tDeslY = Math.cos(t * 1.8) * 1.8;
      let tInclinacao = 0;
      let tOlhoAberto = 1;
      let tOlhoEscala = 1;
      let tBoca = 0;
      let tPataE = 0;
      let tPataD = 0;

      if (t > proximaPiscadaRef.current && !SEM_PISCAR.includes(a)) {
        tOlhoAberto = 0.06;
        if (t > proximaPiscadaRef.current + 0.14) {
          proximaPiscadaRef.current = t + 2.5 + Math.random() * 3.5;
        }
      }

      switch (a) {
        case 'listening':
          tOlhoEscala = 1.12;
          tInclinacao = (tOlhoX / RAIO) * 0.16;
          break;
        case 'thinking':
          tOlhoX = Math.cos(t * 3) * (RAIO * 0.26);
          tOlhoY = -RAIO * 0.22;
          tInclinacao = 0.06;
          break;
        case 'working':
          tOlhoX = Math.sin(t * 14) * (RAIO * 0.2);
          tOlhoY = RAIO * 0.08;
          tPataE = -RAIO * 0.35 + Math.sin(t * 28) * 4;
          tPataD = -RAIO * 0.35 + Math.cos(t * 28) * 4;
          break;
        case 'success':
          tDeslY = -Math.abs(Math.sin(t * 7)) * 7;
          break;
        case 'error':
          tInclinacao = Math.sin(t * 35) * 0.07;
          break;
        case 'permission':
          tOlhoEscala = 1.22;
          tPataD = -RAIO * 0.42 + Math.sin(t * 8) * 5;
          break;
        case 'poked':
          tEscalaX = 1.09;
          tEscalaY = 0.92;
          tOlhoAberto = 0.1;
          break;
        case 'dizzy':
          tInclinacao = Math.sin(t * 16) * 0.1;
          break;
        case 'dragged':
          tEscalaX = 0.93;
          tEscalaY = 1.08;
          tPataE = RAIO * 0.18 + Math.sin(t * 10) * 4;
          tPataD = RAIO * 0.18 - Math.sin(t * 10) * 4;
          break;
        case 'sleeping':
          tOlhoAberto = 0.05;
          tDeslY = 4;
          break;
        case 'notification':
          tDeslY = -Math.max(0, Math.sin(tempo * 10)) * 7;
          break;
        case 'swallow': {
          const progresso = Math.min(1, tempo / 1.1);
          const engole = Math.sin(progresso * Math.PI);
          tEscalaX = 1 + engole * 0.1;
          tEscalaY = 1 + engole * 0.1;
          tBoca = engole;
          break;
        }
        case 'dancing': {
          const batida = Math.abs(Math.sin(t * 6.5));
          tDeslY = -batida * 6;
          tInclinacao = Math.sin(t * 3.25) * 0.1;
          tPataE = -RAIO * 0.25 - batida * 5;
          tPataD = -RAIO * 0.25 - (1 - batida) * 5;
          break;
        }
        case 'pending':
          // Olhar de lado (😒)
          tOlhoX = RAIO * 0.26;
          tOlhoY = RAIO * 0.02;
          break;
        case 'denied': {
          // Cabeça girando de lado (🙂‍↔️)
          const guinada = Math.sin(tempo * 15) * Math.exp(-tempo * 1.15);
          tDeslX = guinada * (RAIO * 0.18);
          tInclinacao = guinada * 0.08;
          tOlhoX = guinada * (RAIO * 0.38);
          tOlhoY = Math.abs(guinada) * (RAIO * 0.04);
          tEscalaX = 1 - Math.abs(guinada) * 0.05;
          break;
        }
        default:
          break;
      }

      // Suavização dos valores
      const s = 0.18;
      anim.olhoX += (tOlhoX - anim.olhoX) * s;
      anim.olhoY += (tOlhoY - anim.olhoY) * s;
      const peso = a === 'denied' ? 0.65 : 0.42;
      anim.rostoX += (tOlhoX * peso - anim.rostoX) * s;
      anim.rostoY += (tOlhoY * 0.42 - anim.rostoY) * s;
      anim.escalaX += (tEscalaX - anim.escalaX) * s;
      anim.escalaY += (tEscalaY - anim.escalaY) * s;
      anim.deslX += (tDeslX - anim.deslX) * s;
      anim.deslY += (tDeslY - anim.deslY) * s;
      anim.inclinacao += (tInclinacao - anim.inclinacao) * s;
      anim.olhoAberto += (tOlhoAberto - anim.olhoAberto) * 0.35;
      anim.olhoEscala += (tOlhoEscala - anim.olhoEscala) * s;
      anim.boca += (tBoca - anim.boca) * 0.25;
      anim.pataE += (tPataE - anim.pataE) * 0.22;
      anim.pataD += (tPataD - anim.pataD) * 0.22;

      // Cores por estado
      let escuro = TEMA.escuro;
      let medio = TEMA.medio;
      let roxo = TEMA.roxo;
      let luz = TEMA.luz;
      let olho = TEMA.olho;
      if (a === 'error' || a === 'denied') {
        escuro = '#1f091d'; medio = '#4c0519'; roxo = '#e11d48'; luz = '#fb7185'; olho = '#ffe4e6';
      } else if (a === 'success') {
        escuro = '#09192f'; medio = '#1e1b4b'; roxo = '#10b981'; luz = '#6ee7b7'; olho = '#ecfdf5';
      } else if (a === 'thinking') {
        escuro = '#0c0a2a'; medio = '#2e1065'; roxo = '#9333ea'; luz = '#d8b4fe';
      } else if (a === 'listening') {
        escuro = '#041434'; medio = '#073585'; roxo = '#0061fe'; luz = '#38bdf8'; olho = '#e0f2fe';
      }

      const cx = PALCO / 2;
      const cy = PALCO / 2 + 2;
      const panX = anim.rostoX * 0.22;
      const panY = anim.rostoY * 0.18;

      ctx.setTransform(escala, 0, 0, escala, 0, 0);
      ctx.clearRect(0, 0, PALCO, PALCO);
      ctx.save();
      ctx.translate(cx + anim.deslX, cy + anim.deslY);
      ctx.rotate(anim.inclinacao);
      ctx.scale(anim.escalaX, anim.escalaY);

      // 0. Ondas sonoras no estado de escuta
      if (a === 'listening') {
        ctx.save();
        const expansaoMax = PALCO - CAIXA - 22;
        for (let i = 0; i < 3; i++) {
          const p = (t * 0.55 + i / 3) % 1;
          const expansao = 8 + p * expansaoMax;
          const alfa = Math.pow(1 - p, 1.6) * 0.65;
          squircle(ctx, 0, DESLOC_PROFUNDIDADE * 0.4, CAIXA + expansao, CAIXA + expansao, CANTO + expansao * 0.5);
          ctx.strokeStyle = `rgba(56, 189, 248, ${alfa.toFixed(3)})`;
          ctx.lineWidth = 2.2;
          ctx.stroke();
        }
        ctx.restore();
      }

      // 1. Profundidade (lateral 3D do cubo)
      ctx.save();
      // shadowBlur é em pixels do canvas (não acompanha o setTransform): multiplica pela escala e
      // mantém o brilho curto, para apagar antes da borda — senão aparece um quadrado atrás do cubo
      ctx.shadowColor = roxo;
      ctx.shadowBlur = 20 * escala;
      squircle(ctx, -panX * 0.4, DESLOC_PROFUNDIDADE - panY * 0.3, CAIXA, CAIXA, CANTO);
      const gradProf = ctx.createLinearGradient(-CAIXA / 2, -CAIXA / 2, CAIXA / 2, CAIXA / 2 + DESLOC_PROFUNDIDADE);
      gradProf.addColorStop(0, '#040714');
      gradProf.addColorStop(0.5, escuro);
      gradProf.addColorStop(1, roxo);
      ctx.fillStyle = gradProf;
      ctx.fill();
      ctx.restore();

      // 2. Corpo cúbico
      squircle(ctx, 0, 0, CAIXA, CAIXA, CANTO);
      const grad = ctx.createLinearGradient(-CAIXA * 0.45, -CAIXA * 0.45, CAIXA * 0.5, CAIXA * 0.5);
      grad.addColorStop(0, escuro);
      grad.addColorStop(0.52, medio);
      grad.addColorStop(1, roxo);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.save();
      ctx.clip();
      const brilho = ctx.createRadialGradient(-CAIXA * 0.22, -CAIXA * 0.28, 8, -CAIXA * 0.1, -CAIXA * 0.15, CAIXA * 0.85);
      brilho.addColorStop(0, 'rgba(192, 132, 252, 0.24)');
      brilho.addColorStop(0.45, 'rgba(59, 130, 246, 0.08)');
      brilho.addColorStop(1, 'rgba(5, 8, 22, 0.45)');
      ctx.fillStyle = brilho;
      ctx.fillRect(-CAIXA / 2, -CAIXA / 2, CAIXA, CAIXA);
      const aro = ctx.createLinearGradient(0, CAIXA * 0.1, 0, CAIXA * 0.52);
      aro.addColorStop(0, 'rgba(109, 40, 217, 0)');
      aro.addColorStop(1, luz);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = aro;
      ctx.fillRect(-CAIXA / 2, 0, CAIXA, CAIXA / 2);
      ctx.restore();

      ctx.lineWidth = 2.4;
      const borda = ctx.createLinearGradient(-CAIXA / 2, -CAIXA / 2, CAIXA / 2, CAIXA / 2);
      borda.addColorStop(0, 'rgba(147, 197, 253, 0.55)');
      borda.addColorStop(0.45, 'rgba(139, 92, 246, 0.25)');
      borda.addColorStop(1, luz);
      ctx.strokeStyle = borda;
      ctx.stroke();

      // 3. Rosto no visor
      ctx.save();
      ctx.translate(anim.rostoX * 0.45, anim.rostoY * 0.35);
      const baseY = CAIXA * DESLOC_OLHOS_Y;

      for (const dir of [-1, 1]) {
        const ex = dir * ESPACO_OLHOS + anim.olhoX;
        const ey = baseY + anim.olhoY;
        ctx.save();
        ctx.translate(ex, ey);
        ctx.shadowColor = luz;
        ctx.shadowBlur = 16 * escala;

        if (a === 'success') {
          ctx.beginPath();
          ctx.arc(0, 5, 11.5, Math.PI * 1.15, Math.PI * 1.85);
          ctx.lineWidth = 4.4;
          ctx.lineCap = 'round';
          ctx.strokeStyle = olho;
          ctx.stroke();
        } else if (a === 'dizzy') {
          ctx.beginPath();
          const s9 = 9;
          ctx.moveTo(-dir * s9, -s9);
          ctx.lineTo(dir * s9, 0);
          ctx.lineTo(-dir * s9, s9);
          ctx.lineWidth = 4.2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = olho;
          ctx.stroke();
        } else if (a === 'pending') {
          // Olhos semicerrados (😒)
          const ew = 19.5;
          const eh = 33;
          squircle(ctx, 0, 0, ew, eh, ew / 2);
          ctx.fillStyle = olho;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = medio;
          ctx.fillRect(-ew * 0.9, -eh * 0.72, ew * 1.8, eh * 0.7);
          ctx.beginPath();
          ctx.moveTo(-ew * 0.78, -eh * 0.02);
          ctx.lineTo(ew * 0.78, -eh * 0.02);
          ctx.lineWidth = 3.5;
          ctx.lineCap = 'round';
          ctx.strokeStyle = olho;
          ctx.stroke();
        } else {
          const ew = Math.max(4, 20 * anim.olhoEscala);
          const eh = Math.max(3.5, 34 * anim.olhoAberto * anim.olhoEscala);
          squircle(ctx, 0, 0, ew, eh, ew / 2);
          ctx.fillStyle = olho;
          ctx.fill();
          if (anim.olhoAberto > 0.4) {
            ctx.shadowBlur = 0;
            squircle(ctx, 0, 0, ew * 0.65, eh * 0.72, (ew * 0.65) / 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // Óculos de sol (sazonal)
      if (a === 'seasonal') {
        ctx.save();
        ctx.translate(anim.olhoX, baseY + anim.olhoY);
        ctx.fillStyle = 'rgba(9, 13, 38, 0.92)';
        ctx.strokeStyle = luz;
        ctx.lineWidth = 2;
        squircle(ctx, -ESPACO_OLHOS, 0, 32, 20, 5);
        ctx.fill();
        ctx.stroke();
        squircle(ctx, ESPACO_OLHOS, 0, 32, 20, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = luz;
        ctx.fillRect(-ESPACO_OLHOS + 15, -2, (ESPACO_OLHOS - 15) * 2, 3);
        ctx.restore();
      }

      // Boca (ao engolir)
      if (anim.boca > 0.12) {
        ctx.beginPath();
        ctx.arc(anim.rostoX * 0.5, baseY + 24, 10 * anim.boca, 0, Math.PI * 2);
        ctx.fillStyle = luz;
        ctx.fill();
      }
      ctx.restore();

      // 4. Patinhas
      if (COM_PATAS.includes(a)) {
        const yPata = CAIXA * 0.44;
        ctx.shadowColor = roxo;
        ctx.shadowBlur = 12 * escala;
        squircle(ctx, -CAIXA * 0.24, yPata + anim.pataE, 26, 17, 8.5);
        ctx.fillStyle = medio;
        ctx.fill();
        ctx.strokeStyle = luz;
        ctx.lineWidth = 2;
        ctx.stroke();
        squircle(ctx, CAIXA * 0.24, yPata + anim.pataD, 26, 17, 8.5);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.restore();
      quadro = requestAnimationFrame(desenhar);
    };

    quadro = requestAnimationFrame(desenhar);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('pointermove', aoMover);
    };
  }, [tamanho]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ width: tamanho, height: tamanho, display: 'block', pointerEvents: 'none', flexShrink: 0 }}
    />
  );
}
