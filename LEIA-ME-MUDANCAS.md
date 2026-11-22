# Aura — protótipo 1 (lógica) + visual do "outro modelo"

## O que mudou em relação ao primeiro protótipo
- `index.html` (visual antigo + simuladores) foi trocado por um `#root` React; o visual vem do outro modelo
  (`src/ui/App.tsx`, Tailwind). Fundo e painel de simulação foram removidos; a janela continua transparente.
- `src/main.ts`: só ganhou `montarUI()`. Todo o resto (voz, Gemini, ações, overlay, atalho) é o do protótipo.
- `src/core/preferencias.ts` (novo): chave do Gemini, Spotify e formato da ilha salvos no app (têm prioridade sobre o `.env`).
  `config.ts`, `ia.ts`, `spotify.ts`, `acoes.ts`, `orquestrador.ts`, `reconhecimento.ts` passaram a ler a chave na hora do uso.
- `src/core/letras.ts` (LRCLIB), `capa.ts` (iTunes), `spotify-vinculo.ts` (login PKCE), `arquivos.ts` (novos).
- `src/core/overlay.ts`: removido o trecho dos botões laterais da ilha antiga.
- Rust (`src-tauri/src/lib.rs`): novos comandos `info_arquivos`, `revelar_arquivo`, `abrir_url`, `clipboard_arquivos`,
  `midia_posicao`, `spotify_aguardar_codigo`; posição da mídia agora é corrigida pelo horário da última atualização.
  `Cargo.toml` (features Win32) e `capabilities/default.json` (lrclib.net, itunes.apple.com) ajustados.
- `package.json`/`vite.config.ts`/`tsconfig.json`: React, Tailwind 3, lucide-react e plugin do Vite.

## Spotify
Crie um app em developer.spotify.com, cadastre a Redirect URI `http://127.0.0.1:8898/callback`,
cole o Client ID em Configurações e clique em Vincular.

## Mascote, timer, aprovações e home (rodada 2)
- `src/ui/Mascote.tsx`: mascote Cubee (port do canvas do `cubee_neo_avatar_interativo.html`).
  Substitui a bolinha verde da pílula de repouso e aparece no cabeçalho da home, na notificação e na aprovação.
  A expressão segue a ilha: pedido pendente → `pending`; ouvindo/falando → `listening`; pensando → `thinking`;
  IA executando → `working`; música tocando → `dancing`; notificação → o tipo dela (sucesso, erro...).
- `src/ui/RolagemNumero.tsx`: dígitos que rolam de cima para baixo (timer estilo iPhone).
- Timer (`mode === 'timer'`): abre ao clicar no relógio da home. Usa o mesmo estado do Pomodoro,
  então "timer 10 minutos" por voz também aparece aqui. Presets 5m / 15m / 25m / 50m.
- Aprovações pendentes (Claude, Gemini...): mostram o nome do app, a mensagem e botões Aceitar / Negar.
  Uso a partir do código: `window.aura.pedirAprovacao("Claude", "Executar: npm install")` devolve uma
  Promise<boolean>, resolvida pelo botão. Ainda não existe a ponte que recebe pedidos de fora do app
  (HTTP local ou arquivo); a API já está pronta para ela.
- Home: ícones em duas páginas com efeito de vidro (`.glass-expo` em `index.css`). Arraste na área
  dos ícones ou toque nas bolinhas para trocar de página.
- Seções da ilha: deslize horizontal troca de seção (mesmo gesto que as bolinhas de paginação).
- Pupila: cantos totalmente arredondados (raio de 32px, vira cápsula nas alturas pequenas).
- Atalho: a gravação também escuta o teclado da própria janela (não depende só do rdev). O status
  aparece ao vivo ("Segurando: Ctrl + Shift…") logo abaixo do botão.

## Rodada 3 (mascote em todos os modos, timer, atalho, ícone)
- **Mascote no lugar da bolinha verde em todos os modos**: o anel verde (`BatteryRing`) foi removido. O mascote agora
  aparece no repouso, no modo fechado (relógio) e no cabeçalho de todas as seções expandidas, sempre com a mesma
  expressão da ilha (`MascoteIlha()` em `App.tsx`). Arquivo solto no shelf/ilha → expressão `swallow`.
- **Recorte sem "invólucro"** (`Mascote.tsx`): o brilho do cubo era cortado na borda do canvas e aparecia como um
  quadrado colorido atrás dele. `shadowBlur` não acompanha o `setTransform`, então agora é multiplicado pela escala e o
  brilho se apaga antes da borda (alfa da borda do canvas medido: 0–1 de 255).
- **Timer** (`RolagemNumero.tsx` + `index.css`): o dígito novo sempre cai de cima e empurra o antigo para baixo, inclusive
  na virada 0→9 (antes a coluna girava ao contrário). Layout igual ao vídeo: dígitos grandes, dois-pontos esmaecido,
  pílula clara Iniciar/Pausar + reiniciar, durações 5m/15m/25m/50m embaixo.
- **Atalho** (`atalho.ts`, `lib.rs`): ao gravar, a janela recebe foco (`setFocus`) e o hook global passa a mostrar as teclas
  ao vivo (novo comando Rust `atalho_segurando`), mesmo que o webview não receba o teclado.
- **Ícone**: `app-icon.png` (1024×1024) gerado do SVG do Cubee; `app-icon.svg` incluído. O `npx tauri icon app-icon.png`
  dos scripts de build regera `src-tauri/icons`.
- Ainda pendente: a ponte que recebe pedidos de aprovação de fora do app (Claude/Gemini). A UI, a expressão `pending`
  e os botões Aceitar/Negar já funcionam via `window.aura.pedirAprovacao(app, mensagem)`.
