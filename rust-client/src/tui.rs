#![allow(dead_code)]
use std::io;
use std::time::Duration;
use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, Borders, Gauge, List, ListItem, ListState, Paragraph, Wrap,
    },
    Frame, Terminal,
};

#[derive(Debug, Clone)]
pub struct DownloadItem {
    pub title: String,
    pub url: String,
    pub status: DownloadStatus,
    pub percent: f32,
    pub speed: String,
    pub eta: String,
    pub total_size: String,
    pub downloaded: String,
    pub output_path: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Finished,
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HistoryItem {
    pub title: String,
    pub path: String,
    pub size: String,
}

pub struct App {
    pub downloads: Vec<DownloadItem>,
    pub history: Vec<HistoryItem>,
    pub active_tab: Tab,
    pub download_list_state: ListState,
    pub history_list_state: ListState,
    pub should_quit: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tab {
    Downloads,
    History,
}

impl App {
    pub fn new() -> Self {
        let mut download_state = ListState::default();
        download_state.select(Some(0));
        let mut history_state = ListState::default();
        history_state.select(Some(0));

        Self {
            downloads: Vec::new(),
            history: load_history(),
            active_tab: Tab::Downloads,
            download_list_state: download_state,
            history_list_state: history_state,
            should_quit: false,
        }
    }

    pub fn next_item(&mut self) {
        let count = match self.active_tab {
            Tab::Downloads => self.downloads.len(),
            Tab::History => self.history.len(),
        };
        if count == 0 { return; }
        let state = match self.active_tab {
            Tab::Downloads => &mut self.download_list_state,
            Tab::History => &mut self.history_list_state,
        };
        let i = state.selected().map(|i| (i + 1) % count).unwrap_or(0);
        state.select(Some(i));
    }

    pub fn prev_item(&mut self) {
        let count = match self.active_tab {
            Tab::Downloads => self.downloads.len(),
            Tab::History => self.history.len(),
        };
        if count == 0 { return; }
        let state = match self.active_tab {
            Tab::Downloads => &mut self.download_list_state,
            Tab::History => &mut self.history_list_state,
        };
        let i = state.selected().map(|i| if i == 0 { count - 1 } else { i - 1 }).unwrap_or(0);
        state.select(Some(i));
    }
}

pub fn run_tui() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new();
    let tick_rate = Duration::from_millis(200);

    loop {
        terminal.draw(|f| ui(f, &mut app))?;

        let timeout = tick_rate;
        if event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') | KeyCode::Esc => app.should_quit = true,
                        KeyCode::Tab | KeyCode::Down => {
                            match key.code {
                                KeyCode::Tab => {
                                    app.active_tab = match app.active_tab {
                                        Tab::Downloads => Tab::History,
                                        Tab::History => Tab::Downloads,
                                    };
                                }
                                KeyCode::Down => app.next_item(),
                                _ => {}
                            }
                        }
                        KeyCode::Up => app.prev_item(),
                        KeyCode::Char('m') => {
                            if let Some(item) = get_selected_item(&app) {
                                play_with_mpv(&item.path);
                            }
                        }
                        KeyCode::Char('v') => {
                            if let Some(item) = get_selected_item(&app) {
                                play_with_vlc(&item.path);
                            }
                        }
                        KeyCode::Char('o') => {
                            if let Some(item) = get_selected_item(&app) {
                                let _ = std::process::Command::new("xdg-open")
                                    .arg(&item.path)
                                    .spawn();
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        if app.should_quit {
            break;
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    Ok(())
}

fn get_selected_item(app: &App) -> Option<&HistoryItem> {
    let idx = app.history_list_state.selected()?;
    app.history.get(idx)
}

fn ui(f: &mut Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(0),
            Constraint::Length(3),
        ])
        .split(f.area());

    // Header
    let header = Paragraph::new(Line::from(vec![
        Span::styled(" YourTube ", Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)),
        Span::raw("  "),
        Span::styled(
            format!("[Downloads: {}]  [History: {}]", app.downloads.len(), app.history.len()),
            Style::default().fg(Color::DarkGray),
        ),
    ]))
    .block(Block::default().borders(Borders::BOTTOM).border_style(Style::default().fg(Color::DarkGray)));
    f.render_widget(header, chunks[0]);

    // Main area
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(45), Constraint::Percentage(55)])
        .split(chunks[1]);

    // Left: download list or history
    match app.active_tab {
        Tab::Downloads => {
            let items: Vec<ListItem> = app.downloads.iter().map(|d| {
                let status_icon = match d.status {
                    DownloadStatus::Queued => Span::styled("QUEUED ", Style::default().fg(Color::DarkGray)),
                    DownloadStatus::Downloading => Span::styled(">>>    ", Style::default().fg(Color::Yellow)),
                    DownloadStatus::Finished => Span::styled("DONE   ", Style::default().fg(Color::Green)),
                    DownloadStatus::Error(_) => Span::styled("ERR    ", Style::default().fg(Color::Red)),
                };
                let pct = if d.status == DownloadStatus::Downloading {
                    format!(" {}%", d.percent)
                } else {
                    String::new()
                };
                ListItem::new(Line::from(vec![
                    status_icon,
                    Span::styled(&d.title, Style::default().fg(Color::White)),
                    Span::styled(pct, Style::default().fg(Color::Yellow)),
                ]))
            }).collect();

            let list = List::new(items)
                .block(Block::default().title(" Downloads ").borders(Borders::ALL).border_style(Style::default().fg(Color::DarkGray)))
                .highlight_style(Style::default().bg(Color::DarkGray).fg(Color::White))
                .highlight_symbol(">> ");
            f.render_stateful_widget(list, main_chunks[0], &mut app.download_list_state);
        }
        Tab::History => {
            let items: Vec<ListItem> = app.history.iter().map(|h| {
                ListItem::new(Line::from(vec![
                    Span::styled("  ", Style::default().fg(Color::Green)),
                    Span::styled(&h.title, Style::default().fg(Color::White)),
                    Span::styled(format!("  [{}]", h.size), Style::default().fg(Color::DarkGray)),
                ]))
            }).collect();

            let list = List::new(items)
                .block(Block::default().title(" History ").borders(Borders::ALL).border_style(Style::default().fg(Color::DarkGray)))
                .highlight_style(Style::default().bg(Color::DarkGray).fg(Color::White))
                .highlight_symbol(">> ");
            f.render_stateful_widget(list, main_chunks[0], &mut app.history_list_state);
        }
    }

    // Right: detail panel
    let detail_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0), Constraint::Length(12)])
        .split(main_chunks[1]);

    // Active downloads detail
    let active: Vec<&DownloadItem> = app.downloads.iter()
        .filter(|d| d.status == DownloadStatus::Downloading)
        .collect();

    if active.is_empty() {
        let empty = Paragraph::new("No active downloads")
            .style(Style::default().fg(Color::DarkGray))
            .block(Block::default().title(" Active ").borders(Borders::ALL).border_style(Style::default().fg(Color::DarkGray)));
        f.render_widget(empty, detail_chunks[0]);
    } else {
        let mut lines: Vec<Line> = Vec::new();
        for d in &active {
            lines.push(Line::from(Span::styled(&d.title, Style::default().fg(Color::White).add_modifier(Modifier::BOLD))));
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled(format!("{}%", d.percent), Style::default().fg(Color::Red)),
                Span::styled("  ", Style::default()),
                Span::styled(&d.speed, Style::default().fg(Color::Cyan)),
                Span::styled("  ETA ", Style::default().fg(Color::DarkGray)),
                Span::styled(&d.eta, Style::default().fg(Color::Yellow)),
            ]));
            if !d.downloaded.is_empty() && !d.total_size.is_empty() {
                lines.push(Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled(&d.downloaded, Style::default().fg(Color::DarkGray)),
                    Span::styled(" / ", Style::default().fg(Color::DarkGray)),
                    Span::styled(&d.total_size, Style::default().fg(Color::DarkGray)),
                ]));
            }
            lines.push(Line::from(""));
        }
        let detail = Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(Block::default().title(" Active ").borders(Borders::ALL).border_style(Style::default().fg(Color::DarkGray)));
        f.render_widget(detail, detail_chunks[0]);
    }

    // Progress bars
    let active_downloads: Vec<&DownloadItem> = app.downloads.iter()
        .filter(|d| d.status == DownloadStatus::Downloading)
        .collect();

    if !active_downloads.is_empty() {
        let bar_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints(
                active_downloads.iter().map(|_| Constraint::Length(2)).collect::<Vec<_>>()
            )
            .split(detail_chunks[1]);

        for (i, d) in active_downloads.iter().enumerate() {
            if i >= bar_chunks.len() { break; }
            let label = format!("{} - {}%", d.title.chars().take(30).collect::<String>(), d.percent);
            let gauge = Gauge::default()
                .block(Block::default().title("").borders(Borders::ALL).border_style(Style::default().fg(Color::DarkGray)))
                .gauge_style(Style::default().fg(Color::Red).bg(Color::Black))
                .ratio(d.percent as f64 / 100.0)
                .label(Span::styled(label, Style::default().fg(Color::White)));
            f.render_widget(gauge, bar_chunks[i]);
        }
    } else {
        let no_active = Paragraph::new("All downloads complete")
            .style(Style::default().fg(Color::DarkGray))
            .block(Block::default().borders(Borders::ALL).border_style(Style::default().fg(Color::DarkGray)));
        f.render_widget(no_active, detail_chunks[1]);
    }

    // Footer
    let footer = Paragraph::new(Line::from(vec![
        Span::styled(" Tab", Style::default().fg(Color::Yellow)),
        Span::styled(": switch  ", Style::default().fg(Color::DarkGray)),
        Span::styled("↑↓", Style::default().fg(Color::Yellow)),
        Span::styled(": navigate  ", Style::default().fg(Color::DarkGray)),
        Span::styled("m", Style::default().fg(Color::Yellow)),
        Span::styled(": mpv  ", Style::default().fg(Color::DarkGray)),
        Span::styled("v", Style::default().fg(Color::Yellow)),
        Span::styled(": vlc  ", Style::default().fg(Color::DarkGray)),
        Span::styled("o", Style::default().fg(Color::Yellow)),
        Span::styled(": open  ", Style::default().fg(Color::DarkGray)),
        Span::styled("q", Style::default().fg(Color::Yellow)),
        Span::styled(": quit", Style::default().fg(Color::DarkGray)),
    ]))
    .block(Block::default().borders(Borders::TOP).border_style(Style::default().fg(Color::DarkGray)));
    f.render_widget(footer, chunks[2]);
}

fn play_with_mpv(path: &str) {
    let _ = std::process::Command::new("mpv")
        .arg(path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

fn play_with_vlc(path: &str) {
    let _ = std::process::Command::new("vlc")
        .arg(path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

fn history_path() -> std::path::PathBuf {
    let dir = dirs::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    dir.join("yourtube").join("history.json")
}

fn load_history() -> Vec<HistoryItem> {
    let path = history_path();
    if !path.exists() { return Vec::new(); }
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save_history(history: &[HistoryItem]) {
    let path = history_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let data = serde_json::to_string_pretty(history).unwrap_or_default();
    let _ = std::fs::write(&path, data);
}

pub fn add_to_history(title: &str, path: &str, size: &str) {
    let mut history = load_history();
    history.insert(0, HistoryItem {
        title: title.to_string(),
        path: path.to_string(),
        size: size.to_string(),
    });
    if history.len() > 100 {
        history.truncate(100);
    }
    save_history(&history);
}
