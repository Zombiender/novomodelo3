use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::Manager;

/// Arquivo com o nome escolhido: <pasta de configuração do app>/nome.txt
fn arquivo_nome(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("nome.txt"))
}

#[tauri::command]
fn ler_nome(app: tauri::AppHandle) -> Option<String> {
    let caminho = arquivo_nome(&app)?;
    let nome = std::fs::read_to_string(caminho).ok()?;
    let nome = nome.trim().to_string();
    if nome.is_empty() { None } else { Some(nome) }
}

#[tauri::command]
fn salvar_nome(app: tauri::AppHandle, nome: String) -> Result<(), String> {
    let caminho = arquivo_nome(&app).ok_or("pasta de configuração indisponível")?;
    if let Some(pasta) = caminho.parent() {
        std::fs::create_dir_all(pasta).map_err(|e| e.to_string())?;
    }
    std::fs::write(caminho, nome.trim()).map_err(|e| e.to_string())
}

/// Sessão de mídia atual do sistema (a mesma que aparece na barra de volume do Windows).
#[derive(Clone, Serialize)]
pub struct Midia {
    pub titulo: String,
    pub artista: String,
    pub app: String,
    pub tocando: bool,
    pub posicao_s: f64,
    pub duracao_s: f64,
}

/// Preenchido pela thread de monitoramento (win::iniciar_monitor).
static MIDIA: std::sync::Mutex<Option<Midia>> = std::sync::Mutex::new(None);

#[tauri::command]
fn midia_atual() -> Option<Midia> {
    MIDIA.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
fn midia_controle(acao: String) {
    #[cfg(windows)]
    win::midia_controle(&acao);
    #[cfg(not(windows))]
    let _ = acao;
}

static CLIQUES: AtomicU64 = AtomicU64::new(0);
static TECLAS: AtomicU64 = AtomicU64::new(0);

// ---------- Atalho global para mostrar a ilha ----------
static GRAVANDO_ATALHO: AtomicBool = AtomicBool::new(false);
static ATALHO_GRAVADO: Mutex<Option<Vec<rdev::Key>>> = Mutex::new(None);
static ATALHO_ATIVO: Mutex<Vec<rdev::Key>> = Mutex::new(Vec::new());
static TECLAS_SEGURADAS: Mutex<Vec<rdev::Key>> = Mutex::new(Vec::new());
static ATALHO_SEGURADO: AtomicBool = AtomicBool::new(false);
static ATALHO_DISPARADO: AtomicBool = AtomicBool::new(false);

/// Nome estável da tecla (ex.: "KeyA", "ControlLeft"), usado na configuração salva.
fn tecla_para_nome(k: rdev::Key) -> String {
    format!("{:?}", k)
}

fn nome_para_tecla(n: &str) -> Option<rdev::Key> {
    use rdev::Key::*;
    Some(match n {
        "KeyA" => KeyA, "KeyB" => KeyB, "KeyC" => KeyC, "KeyD" => KeyD, "KeyE" => KeyE,
        "KeyF" => KeyF, "KeyG" => KeyG, "KeyH" => KeyH, "KeyI" => KeyI, "KeyJ" => KeyJ,
        "KeyK" => KeyK, "KeyL" => KeyL, "KeyM" => KeyM, "KeyN" => KeyN, "KeyO" => KeyO,
        "KeyP" => KeyP, "KeyQ" => KeyQ, "KeyR" => KeyR, "KeyS" => KeyS, "KeyT" => KeyT,
        "KeyU" => KeyU, "KeyV" => KeyV, "KeyW" => KeyW, "KeyX" => KeyX, "KeyY" => KeyY,
        "KeyZ" => KeyZ,
        "Num0" => Num0, "Num1" => Num1, "Num2" => Num2, "Num3" => Num3, "Num4" => Num4,
        "Num5" => Num5, "Num6" => Num6, "Num7" => Num7, "Num8" => Num8, "Num9" => Num9,
        "F1" => F1, "F2" => F2, "F3" => F3, "F4" => F4, "F5" => F5, "F6" => F6,
        "F7" => F7, "F8" => F8, "F9" => F9, "F10" => F10, "F11" => F11, "F12" => F12,
        "ControlLeft" => ControlLeft, "ControlRight" => ControlRight,
        "ShiftLeft" => ShiftLeft, "ShiftRight" => ShiftRight,
        "Alt" => Alt, "AltGr" => AltGr, "MetaLeft" => MetaLeft, "MetaRight" => MetaRight,
        "Space" => Space, "Return" => Return, "Escape" => Escape, "Tab" => Tab,
        "Backspace" => Backspace, "CapsLock" => CapsLock, "Insert" => Insert,
        "Delete" => Delete, "Home" => Home, "End" => End,
        "PageUp" => PageUp, "PageDown" => PageDown,
        "UpArrow" => UpArrow, "DownArrow" => DownArrow,
        "LeftArrow" => LeftArrow, "RightArrow" => RightArrow,
        _ => return None,
    })
}

/// Trata cada evento global de teclado/mouse (roda na thread do rdev).
fn processar_evento(tipo: rdev::EventType) {
    use rdev::EventType;
    match tipo {
        EventType::ButtonPress(_) => {
            CLIQUES.fetch_add(1, Ordering::Relaxed);
        }
        EventType::KeyPress(k) => {
            TECLAS.fetch_add(1, Ordering::Relaxed);
            let seguradas = match TECLAS_SEGURADAS.lock() {
                Ok(mut s) => {
                    if !s.contains(&k) {
                        s.push(k);
                    }
                    s.clone()
                }
                Err(_) => return,
            };
            if !GRAVANDO_ATALHO.load(Ordering::Relaxed) {
                let combo = ATALHO_ATIVO.lock().map(|g| g.clone()).unwrap_or_default();
                let satisfeito = !combo.is_empty() && combo.iter().all(|c| seguradas.contains(c));
                // Dispara uma vez por pressionamento (ignora a repetição automática da tecla)
                if satisfeito && !ATALHO_SEGURADO.swap(true, Ordering::Relaxed) {
                    ATALHO_DISPARADO.store(true, Ordering::Relaxed);
                }
            }
        }
        EventType::KeyRelease(k) => {
            if GRAVANDO_ATALHO.load(Ordering::Relaxed) {
                // Ao soltar a primeira tecla, grava todas que estavam pressionadas (a combinação)
                let snapshot = TECLAS_SEGURADAS.lock().map(|g| g.clone()).unwrap_or_default();
                if !snapshot.is_empty() {
                    if let Ok(mut g) = ATALHO_GRAVADO.lock() {
                        *g = Some(snapshot);
                    }
                    GRAVANDO_ATALHO.store(false, Ordering::Relaxed);
                }
            }
            if let Ok(mut s) = TECLAS_SEGURADAS.lock() {
                s.retain(|x| *x != k);
            }
            ATALHO_SEGURADO.store(false, Ordering::Relaxed);
        }
        _ => {}
    }
}

#[tauri::command]
fn gravar_atalho() {
    if let Ok(mut g) = ATALHO_GRAVADO.lock() {
        *g = None;
    }
    GRAVANDO_ATALHO.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn cancelar_gravacao() {
    GRAVANDO_ATALHO.store(false, Ordering::Relaxed);
}

/// Teclas pressionadas neste instante (hook global): mostra a gravação ao vivo mesmo sem foco na janela.
#[tauri::command]
fn atalho_segurando() -> Vec<String> {
    TECLAS_SEGURADAS
        .lock()
        .map(|g| g.iter().map(|k| tecla_para_nome(*k)).collect())
        .unwrap_or_default()
}

/// Devolve a combinação gravada (uma vez) ou None se ainda não houve gravação.
#[tauri::command]
fn atalho_gravado() -> Option<Vec<String>> {
    let mut g = ATALHO_GRAVADO.lock().ok()?;
    let teclas = g.take()?;
    Some(teclas.into_iter().map(tecla_para_nome).collect())
}

#[tauri::command]
fn definir_atalho(teclas: Vec<String>) {
    let convertidas: Vec<rdev::Key> = teclas.iter().filter_map(|n| nome_para_tecla(n)).collect();
    if let Ok(mut g) = ATALHO_ATIVO.lock() {
        *g = convertidas;
    }
    ATALHO_SEGURADO.store(false, Ordering::Relaxed);
}

/// true uma vez por pressionamento do atalho (o overlay alterna a visibilidade a cada true).
#[tauri::command]
fn atalho_disparado() -> bool {
    ATALHO_DISPARADO.swap(false, Ordering::Relaxed)
}

/// Cliques e teclas globais (substitui pynput).
#[tauri::command]
fn contadores_entrada() -> (u64, u64) {
    (CLIQUES.load(Ordering::Relaxed), TECLAS.load(Ordering::Relaxed))
}

#[tauri::command]
fn alterar_volume(aumentar: bool) {
    #[cfg(windows)]
    win::tecla_midia(if aumentar { 0xAF } else { 0xAE }, 5); // VK_VOLUME_UP / DOWN
    #[cfg(not(windows))]
    let _ = aumentar;
}

fn executar_shutdown(args: &[&str]) -> Result<(), String> {
    let mut cmd = std::process::Command::new("shutdown");
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    match cmd.status() {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("shutdown retornou {s}")),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn agendar_desligamento(minutos: u32) -> Result<(), String> {
    if minutos == 0 {
        return Err("minutos inválidos".into());
    }
    executar_shutdown(&["/s", "/t", &(minutos as u64 * 60).to_string()])
}

#[tauri::command]
fn cancelar_desligamento() -> Result<(), String> {
    executar_shutdown(&["/a"])
}

/// true se a janela em primeiro plano é do próprio app, do desktop/barra de tarefas,
/// invisível ou minimizada (a ilha só aparece nesses casos).
#[tauri::command]
fn primeiro_plano_e_area_de_trabalho() -> bool {
    #[cfg(windows)]
    {
        win::primeiro_plano_e_desktop()
    }
    #[cfg(not(windows))]
    {
        true
    }
}

#[cfg(windows)]
mod win {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Gerenciador,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
    use windows::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    };

    const CLASSES: [&str; 6] = [
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd",
        "NotifyIconOverflowWindow", "Windows.UI.Core.CoreWindow",
    ];

    pub fn tecla_midia(vk: u8, vezes: u8) {
        unsafe {
            for _ in 0..vezes {
                keybd_event(vk, 0, KEYBD_EVENT_FLAGS(0), 0);
                keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
            }
        }
    }

    /// Lê a sessão de mídia atual do Windows (chamado pela thread de monitoramento).
    fn ler_midia() -> windows::core::Result<Option<super::Midia>> {
        let gerenciador = Gerenciador::RequestAsync()?.get()?;
        let sessao = match gerenciador.GetCurrentSession() {
            Ok(s) => s,
            Err(_) => return Ok(None),
        };
        let props = sessao.TryGetMediaPropertiesAsync()?.get()?;
        let info = sessao.GetPlaybackInfo()?;
        let tempo = sessao.GetTimelineProperties()?;
        let tocando = info.PlaybackStatus()? == Status::Playing;
        // TimeSpan é contado em intervalos de 100 ns
        let duracao_s = tempo.EndTime()?.Duration as f64 / 1e7;
        let mut posicao_s = tempo.Position()?.Duration as f64 / 1e7;
        if tocando {
            // O Windows guarda a posição do último evento: soma o tempo decorrido desde então
            // (DateTime conta 100 ns desde 1601; 116444736000000000 = diferença até 1970).
            let atualizado = tempo.LastUpdatedTime()?.UniversalTime;
            let agora = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| (d.as_nanos() / 100) as i64 + 116_444_736_000_000_000)
                .unwrap_or(0);
            if atualizado > 0 && agora > atualizado {
                posicao_s += (agora - atualizado) as f64 / 1e7;
            }
        }
        if duracao_s > 0.0 && posicao_s > duracao_s {
            posicao_s = duracao_s;
        }
        Ok(Some(super::Midia {
            titulo: props.Title()?.to_string(),
            artista: props.Artist()?.to_string(),
            app: sessao.SourceAppUserModelId()?.to_string(),
            tocando,
            posicao_s,
            duracao_s,
        }))
    }

    /// Thread própria (COM/WinRT em MTA) que atualiza o snapshot a cada ~0,8 s.
    pub fn iniciar_monitor() {
        std::thread::spawn(|| {
            unsafe {
                let _ = RoInitialize(RO_INIT_MULTITHREADED);
            }
            loop {
                let atual = ler_midia().unwrap_or(None);
                if let Ok(mut guarda) = super::MIDIA.lock() {
                    *guarda = atual;
                }
                std::thread::sleep(std::time::Duration::from_millis(800));
            }
        });
    }

    /// Envia play/pausa, próxima ou anterior para a sessão atual (em thread própria, sem travar a UI).
    pub fn midia_controle(acao: &str) {
        let acao = acao.to_string();
        std::thread::spawn(move || {
            unsafe {
                let _ = RoInitialize(RO_INIT_MULTITHREADED);
            }
            let Ok(gerenciador) = Gerenciador::RequestAsync().and_then(|op| op.get()) else {
                return;
            };
            let Ok(sessao) = gerenciador.GetCurrentSession() else {
                return;
            };
            let _ = match acao.as_str() {
                "playpause" => sessao.TryTogglePlayPauseAsync().and_then(|op| op.get()),
                "next" => sessao.TrySkipNextAsync().and_then(|op| op.get()),
                "prev" => sessao.TrySkipPreviousAsync().and_then(|op| op.get()),
                _ => return,
            };
        });
    }


    /// Arquivos copiados no clipboard (formato CF_HDROP). None = sem mudança ou clipboard ocupado.
    pub fn clipboard_arquivos(ultima: u32) -> Option<(u32, Vec<String>)> {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::DataExchange::{
            CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
            OpenClipboard,
        };
        use windows::Win32::System::Ole::CF_HDROP;
        use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
        unsafe {
            let seq = GetClipboardSequenceNumber();
            if seq == ultima {
                return None;
            }
            if IsClipboardFormatAvailable(CF_HDROP.0 as u32).is_err() {
                return Some((seq, Vec::new()));
            }
            if OpenClipboard(HWND::default()).is_err() {
                return None; // outro app está usando o clipboard: tenta no próximo ciclo
            }
            let mut caminhos = Vec::new();
            if let Ok(h) = GetClipboardData(CF_HDROP.0 as u32) {
                let hdrop = HDROP(h.0);
                let total = DragQueryFileW(hdrop, 0xFFFF_FFFF, None);
                for i in 0..total {
                    let tam = DragQueryFileW(hdrop, i, None) as usize;
                    let mut buf = vec![0u16; tam + 1];
                    let n = DragQueryFileW(hdrop, i, Some(&mut buf)) as usize;
                    caminhos.push(String::from_utf16_lossy(&buf[..n]));
                }
            }
            let _ = CloseClipboard();
            Some((seq, caminhos))
        }
    }

    /// Pula para uma posição (em segundos) na faixa atual.
    pub fn midia_posicao(segundos: f64) {
        std::thread::spawn(move || {
            unsafe {
                let _ = RoInitialize(RO_INIT_MULTITHREADED);
            }
            let Ok(gerenciador) = Gerenciador::RequestAsync().and_then(|op| op.get()) else {
                return;
            };
            let Ok(sessao) = gerenciador.GetCurrentSession() else {
                return;
            };
            // TimeSpan é contado em intervalos de 100 ns
            let _ = sessao
                .TryChangePlaybackPositionAsync((segundos.max(0.0) * 1e7) as i64)
                .and_then(|op| op.get());
        });
    }

    pub fn primeiro_plano_e_desktop() -> bool {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() {
                return true;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == std::process::id() {
                return true;
            }
            let mut buf = [0u16; 256];
            let n = GetClassNameW(hwnd, &mut buf).max(0) as usize;
            if CLASSES.contains(&String::from_utf16_lossy(&buf[..n]).as_str()) {
                return true;
            }
            !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool()
        }
    }
}


// ---------- Arquivos: informações, Explorer e clipboard ----------
#[derive(Clone, Serialize)]
pub struct InfoArquivo {
    pub nome: String,
    pub caminho: String,
    pub tamanho: u64,
    pub pasta: bool,
}

#[tauri::command]
fn info_arquivos(caminhos: Vec<String>) -> Vec<InfoArquivo> {
    caminhos
        .into_iter()
        .filter_map(|c| {
            let p = std::path::Path::new(&c);
            let meta = std::fs::metadata(p).ok()?;
            Some(InfoArquivo {
                nome: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| c.clone()),
                caminho: c,
                tamanho: if meta.is_file() { meta.len() } else { 0 },
                pasta: meta.is_dir(),
            })
        })
        .collect()
}

/// Abre o Explorer com o arquivo selecionado.
#[tauri::command]
fn revelar_arquivo(caminho: String) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", caminho))
            .spawn();
    }
    #[cfg(not(windows))]
    let _ = caminho;
}

/// Abre uma URL (http/https) no navegador padrão.
#[tauri::command]
fn abrir_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("URL inválida".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Clone, Serialize)]
pub struct ClipboardArquivos {
    pub seq: u32,
    pub caminhos: Vec<String>,
}

/// Arquivos copiados (Ctrl+C no Explorer). Só responde se o clipboard mudou desde `ultima_seq`.
#[tauri::command]
fn clipboard_arquivos(ultima_seq: u32) -> Option<ClipboardArquivos> {
    #[cfg(windows)]
    {
        return win::clipboard_arquivos(ultima_seq)
            .map(|(seq, caminhos)| ClipboardArquivos { seq, caminhos });
    }
    #[cfg(not(windows))]
    {
        let _ = ultima_seq;
        None
    }
}

#[tauri::command]
fn midia_posicao(segundos: f64) {
    #[cfg(windows)]
    win::midia_posicao(segundos);
    #[cfg(not(windows))]
    let _ = segundos;
}

/// Vinculação do Spotify: escuta uma única requisição em 127.0.0.1 e devolve o "code".
#[tauri::command]
async fn spotify_aguardar_codigo(porta: u16) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Read, Write};
        use std::time::{Duration, Instant};
        let ouvinte = std::net::TcpListener::bind(("127.0.0.1", porta)).map_err(|e| e.to_string())?;
        ouvinte.set_nonblocking(true).map_err(|e| e.to_string())?;
        let limite = Instant::now() + Duration::from_secs(180);
        loop {
            match ouvinte.accept() {
                Ok((mut fluxo, _)) => {
                    let _ = fluxo.set_nonblocking(false);
                    let _ = fluxo.set_read_timeout(Some(Duration::from_secs(5)));
                    let mut buf = [0u8; 4096];
                    let n = fluxo.read(&mut buf).unwrap_or(0);
                    if n == 0 {
                        continue;
                    }
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let corpo = "<html><body style=\"font-family:sans-serif;background:#111;color:#fff;text-align:center;padding-top:15vh\"><h2>Spotify vinculado!</h2><p>Você já pode fechar esta aba.</p></body></html>";
                    let resposta = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        corpo.len(),
                        corpo
                    );
                    let _ = fluxo.write_all(resposta.as_bytes());
                    let linha = req.lines().next().unwrap_or("");
                    let consulta = linha
                        .split_whitespace()
                        .nth(1)
                        .unwrap_or("")
                        .split('?')
                        .nth(1)
                        .unwrap_or("");
                    for par in consulta.split('&') {
                        if let Some(v) = par.strip_prefix("code=") {
                            return Ok(v.to_string());
                        }
                        if par.starts_with("error=") {
                            return Err("Autorização negada no Spotify".to_string());
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() > limite {
                        return Err("Tempo esgotado esperando o login do Spotify".to_string());
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    win::iniciar_monitor();

    std::thread::spawn(|| {
        let _ = rdev::listen(|e| processar_evento(e.event_type));
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            contadores_entrada,
            alterar_volume,
            agendar_desligamento,
            cancelar_desligamento,
            primeiro_plano_e_area_de_trabalho,
            midia_atual,
            midia_controle,
            gravar_atalho,
            cancelar_gravacao,
            atalho_gravado,
            atalho_segurando,
            definir_atalho,
            atalho_disparado,
            ler_nome,
            salvar_nome,
            info_arquivos,
            revelar_arquivo,
            abrir_url,
            clipboard_arquivos,
            midia_posicao,
            spotify_aguardar_codigo
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Tauri");
}
