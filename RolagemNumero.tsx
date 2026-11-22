/**
 * Números que "caem" ao mudar, no estilo do timer do iPhone: o dígito novo desce de cima
 * e empurra o antigo para baixo. A direção é sempre de cima para baixo, inclusive na virada
 * (0 → 9). Usa `em`, então o tamanho vem do pai.
 */
import { useState } from 'react';

interface Par { de: number | null; para: number; n: number }

export function RolagemDigito({ valor }: { valor: number }) {
  const [par, setPar] = useState<Par>({ de: null, para: valor, n: 0 });

  // Troca de valor: guarda o anterior e reinicia a animação (ajuste durante a renderização, sem piscar)
  if (par.para !== valor) setPar({ de: par.para, para: valor, n: par.n + 1 });

  const celula = 'block h-[1em] leading-none text-center';
  return (
    <span className="relative inline-block h-[1em] w-[0.64em] overflow-hidden align-top">
      {par.de === null ? (
        <span className={celula}>{par.para}</span>
      ) : (
        <span key={par.n} className="aura-digito-cai flex flex-col">
          <span className={celula}>{par.para}</span>
          <span className={celula}>{par.de}</span>
        </span>
      )}
    </span>
  );
}

export function RolagemNumero({ texto, className = '' }: { texto: string; className?: string }) {
  return (
    <span className={`inline-flex items-center tabular-nums ${className}`} aria-label={texto}>
      {Array.from(texto).map((c, i) =>
        /\d/.test(c) ? (
          <RolagemDigito key={i} valor={Number(c)} />
        ) : (
          <span key={i} className="w-[0.3em] text-center opacity-30">
            {c}
          </span>
        ),
      )}
    </span>
  );
}
