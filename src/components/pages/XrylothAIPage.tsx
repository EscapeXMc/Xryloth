import { useState, useRef, useEffect, useCallback } from "react";
import { useLauncherStore } from "../../stores";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";
import { GlassInput } from "../ui/FormControls";
import { Select } from "../ui/Select";
import {
  AlertTriangle, Bot, FileText, Search, Send, User, Sparkles,
  Terminal, Folder, FolderOpen, File, Trash2, ChevronRight,
  Play, ArrowUp, Copy, Download, RefreshCw, Wrench,
  Server, Gamepad2, Boxes, CheckCircle2, Loader2, Plug, ListChecks,
} from "lucide-react";
import { api } from "../../lib/api";
import { isTauri } from "../../lib/tauri";
import { listen } from "@tauri-apps/api/event";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  tools?: { tool: string; status: string; summary?: string }[];
}

interface AiContext { kind: string; name: string }

// Lightweight markdown renderer (bold, italic, inline code, code blocks, lists, headings).
function renderInline(text: string, prefix: string, tc: { text_main: string; bg_card2: string }): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={`${prefix}-b${i}`} style={{ color: tc.text_main, fontWeight: 700 }}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={`${prefix}-c${i}`} style={{ background: `${tc.bg_card2}aa`, padding: "1px 4px", borderRadius: 4, fontFamily: "monospace", fontSize: "0.92em" }}>{tok.slice(1, -1)}</code>);
    else parts.push(<em key={`${prefix}-i${i}`}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Markdown({ text, tc }: { text: string; tc: { text_main: string; text_sub: string; bg_card2: string; border: string; accent: string } }) {
  const blocks = text.split("```");
  const out: React.ReactNode[] = [];
  blocks.forEach((block, bi) => {
    if (bi % 2 === 1) {
      const nl = block.indexOf("\n");
      const code = nl > 0 ? block.slice(nl + 1) : block;
      out.push(
        <pre key={`code-${bi}`} className="text-[11px] p-2.5 rounded-lg overflow-x-auto my-2"
          style={{ background: "#0a0a0f", color: "#e6e6e6", border: `1px solid ${tc.border}` }}>
          <code style={{ fontFamily: "monospace", whiteSpace: "pre" }}>{code.replace(/\n$/, "")}</code>
        </pre>
      );
      return;
    }
    const lines = block.split("\n");
    let bullets: string[] = [];
    let numbers: string[] = [];
    let para: string[] = [];

    const flush = (k: string) => {
      if (bullets.length) {
        out.push(<ul key={`ul-${k}`} className="list-disc pl-5 my-1 space-y-0.5">{bullets.map((b, j) => <li key={j} className="text-xs" style={{ color: tc.text_sub }}>{renderInline(b, `${k}-${j}`, tc)}</li>)}</ul>);
        bullets = [];
      }
      if (numbers.length) {
        out.push(<ol key={`ol-${k}`} className="list-decimal pl-5 my-1 space-y-0.5">{numbers.map((b, j) => <li key={j} className="text-xs" style={{ color: tc.text_sub }}>{renderInline(b, `${k}-n${j}`, tc)}</li>)}</ol>);
        numbers = [];
      }
      if (para.length) {
        out.push(<p key={`p-${k}`} className="text-xs my-1 leading-relaxed" style={{ color: tc.text_sub }}>{renderInline(para.join(" "), `${k}-p`, tc)}</p>);
        para = [];
      }
    };

    lines.forEach((raw, li) => {
      const line = raw.replace(/\s+$/, "");
      const idx = `${bi}-${li}`;
      if (line.trim() === "") { flush(idx); return; }
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      if (heading) {
        flush(idx);
        const size = 13 + (4 - heading[1].length) * 1.5;
        out.push(<p key={`h-${idx}`} style={{ color: tc.text_main, fontSize: size, fontWeight: 700, margin: "8px 0 3px" }}>{renderInline(heading[2], `${idx}-h`, tc)}</p>);
        return;
      }
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (bullet) { flush(`${bi}-${li}-pre`); bullets.push(bullet[1]); return; }
      const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (num) { flush(`${bi}-${li}-pre`); numbers.push(num[1]); return; }
      bullets.length === 0 && numbers.length === 0 ? para.push(line) : flush(idx);
    });
    flush(`end-${bi}`);
  });
  return <div className="min-w-0">{out}</div>;
}

type TabType = "chat" | "terminal" | "files" | "crash";

// Platform awareness so the terminal / file manager work on every OS.
const IS_WINDOWS =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
const ROOT_PATH = IS_WINDOWS ? "C:\\" : "/";

const QUICK_COMMANDS = IS_WINDOWS
  ? [
      { label: "Kill Minecraft", cmd: "taskkill /F /IM javaw.exe & taskkill /F /IM java.exe" },
      { label: "Flush DNS", cmd: "ipconfig /flushdns" },
      { label: "Clear Temp", cmd: "del /q /f /s %TEMP%\\*" },
      { label: "System Info", cmd: "systeminfo" },
      { label: "Check Java", cmd: "java -version" },
      { label: "GPU Info", cmd: "wmic path win32_videocontroller get name,driverversion" },
      { label: "Disk Space", cmd: "wmic logicaldisk get size,freespace,caption" },
      { label: "RAM Info", cmd: "wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /Value" },
    ]
  : [
      { label: "Kill Minecraft", cmd: "pkill -f javaw; pkill -f java" },
      { label: "System Info", cmd: "uname -a" },
      { label: "Check Java", cmd: "java -version" },
      { label: "Disk Space", cmd: "df -h" },
      { label: "RAM Info", cmd: "free -h" },
      { label: "Top Processes", cmd: "ps aux --sort=-%cpu | head -15" },
    ];

export function XrylothAIPage() {
  const { themeColors, setPage } = useLauncherStore();
  const [activeTab, setActiveTab] = useState<TabType>("chat");
  const chatRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Hey! I'm **Xryloth AI** — your launcher and server assistant with 200+ tools.\n\nI can create servers, install plugins, manage whitelists, run console commands, edit profiles, browse mods, and switch pages for you. Just tell me what you want, for example:\n\n- *\"Create a Paper server called ForizCart for 1.21.11 on port 25579 with the default MOTD\"*\n- *\"Install ViaVersion into ForizCart\"*\n- *\"Add Notch to the whitelist\"*\n\nPick a **server** or **profile** below to focus my actions on it.",
    }
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [liveTools, setLiveTools] = useState<{ tool: string; status: string; summary?: string }[]>([]);
  const [statusText, setStatusText] = useState("");

  // Workspace context (server or profile the AI focuses on)
  const [ctxKind, setCtxKind] = useState("");
  const [ctxName, setCtxName] = useState("");
  const [serverList, setServerList] = useState<{ name: string; running: boolean; version: string; type: string }[]>([]);
  const [instanceList, setInstanceList] = useState<{ name: string; version: string; loader: string }[]>([]);

  const streamRef = useRef("");
  const toolsRef = useRef<{ tool: string; status: string; summary?: string }[]>([]);

  // Terminal state
  const [terminalHistory, setTerminalHistory] = useState<string[]>([]);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  // File manager state
  const [currentPath, setCurrentPath] = useState(ROOT_PATH);
  const [dirEntries, setDirEntries] = useState<{ name: string; is_dir: boolean; size: number; path: string }[]>([]);
  const [fileContent, setFileContent] = useState("");
  const [editingFile, setEditingFile] = useState("");
  const [fileLoading, setFileLoading] = useState(false);

  // Crash state
  const [crashInstance, setCrashInstance] = useState("");
  const [crashInstances, setCrashInstances] = useState<any[]>([]);
  const [crashResult, setCrashResult] = useState<any>(null);
  const [analyzingCrash, setAnalyzingCrash] = useState(false);

  // Quick commands
  const quickCommands = QUICK_COMMANDS;

  useEffect(() => {
    api.instances.get().then(setCrashInstances).catch(() => {});
    loadDir(ROOT_PATH);
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [terminalHistory]);

  const loadDir = async (path: string) => {
    setFileLoading(true);
    try {
      const result = await api.systemCmd.listDir(path);
      if (result.success && result.entries) {
        const sorted = result.entries.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setDirEntries(sorted);
        setCurrentPath(path);
      }
    } catch {}
    setFileLoading(false);
  };

  const readFile = async (path: string) => {
    setFileLoading(true);
    try {
      const result = await api.systemCmd.readFile(path);
      if (result.success && result.content !== undefined) {
        setFileContent(result.content);
        setEditingFile(path);
      }
    } catch {}
    setFileLoading(false);
  };

  const saveFile = async () => {
    if (!editingFile) return;
    try {
      await api.systemCmd.writeFile(editingFile, fileContent);
    } catch {}
  };

  const deleteFileOrDir = async (path: string) => {
    try {
      await api.systemCmd.deletePath(path);
      loadDir(currentPath);
    } catch {}
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const execTerminal = async (cmd: string) => {
    if (!cmd.trim() || terminalRunning) return;
    const prompt = `${currentPath}> `;
    setTerminalHistory(prev => [...prev, `${prompt}${cmd}`]);
    setCommandHistory(prev => [cmd, ...prev]);
    setHistoryIdx(-1);
    setTerminalInput("");
    setTerminalRunning(true);

    try {
      const result = await api.systemCmd.runCommand(cmd);
      if (result.stdout) {
        result.stdout.split("\n").forEach(line => {
          if (line.trim()) setTerminalHistory(prev => [...prev, line]);
        });
      }
      if (result.stderr) {
        result.stderr.split("\n").forEach(line => {
          if (line.trim()) setTerminalHistory(prev => [...prev, `[ERROR] ${line}`]);
        });
      }
      if (!result.success && result.error) {
        setTerminalHistory(prev => [...prev, `[ERROR] ${result.error}`]);
      }
    } catch (e: any) {
      setTerminalHistory(prev => [...prev, `[ERROR] ${e.message || "Command failed"}`]);
    }

    setTerminalRunning(false);
  };

  // Load workspace lists once.
  const loadWorkspaces = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const s = await api.serverMgr.list();
      if (s && (s as any).success) {
        setServerList((((s as any).servers || []) as any[]).map((x) => ({ name: x.name, running: !!x.running, version: x.version, type: x.type })));
      }
    } catch {}
    try {
      const inst = await api.instances.get();
      setInstanceList(((inst || []) as any[]).map((x) => ({ name: x.name, version: x.version, loader: x.loader })));
    } catch {}
  }, []);

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  // Live AI streaming + tool activity. Guarded so React StrictMode's double
  // mount cannot leak listeners (each event would double otherwise).
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unlisteners: (() => void)[] = [];
    (async () => {
      const unA = await listen<{ chunk?: string; text?: string }>("ai-chunk", (e) => {
        const piece = e.payload.chunk ?? e.payload.text ?? "";
        if (!piece) return;
        streamRef.current += piece;
        setStreamText(streamRef.current);
      });
      if (cancelled) unA(); else unlisteners.push(unA);

      const unB = await listen<{ tool: string; status: string; summary?: string }>("ai-tool", (e) => {
        const tool = { tool: e.payload.tool, status: e.payload.status, summary: e.payload.summary };
        const prev = toolsRef.current;
        const idx = prev.findIndex((t) => t.tool === e.payload.tool && t.status !== "done" && t.status !== "error");
        if (idx >= 0) { prev[idx] = { ...prev[idx], status: e.payload.status, summary: e.payload.summary }; }
        else { prev.push(tool); }
        setLiveTools([...prev]);
      });
      if (cancelled) unB(); else unlisteners.push(unB);

      const unC = await listen<{ text: string }>("ai-status", (e) => setStatusText(e.payload.text));
      if (cancelled) unC(); else unlisteners.push(unC);

      // The AI can navigate pages, launch a profile, or change the workspace.
      const unD = await listen<{ type: string; page?: string; name?: string; kind?: string }>("ai-action", (e) => {
        const p = e.payload;
        if (p.type === "navigate" && p.page) setPage(p.page);
        else if (p.type === "launch-instance" && p.name) {
          window.dispatchEvent(new CustomEvent("ec-launch-game", { detail: { instanceName: p.name } }));
        } else if (p.type === "context") {
          setCtxKind(p.kind || "");
          setCtxName(p.name || "");
          if (p.kind === "server" && p.name) loadWorkspaces();
        } else if (p.type && p.type.startsWith("refresh-")) {
          loadWorkspaces();
        }
      });
      if (cancelled) unD(); else unlisteners.push(unD);
    })();
    return () => { cancelled = true; unlisteners.forEach((fn) => fn()); };
  }, [setPage, loadWorkspaces]);

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || thinking) return;
    const lower = content.toLowerCase();

    setMessages(prev => [...prev, { role: "user", content }]);
    setInput("");
    setThinking(true);
    setStreamText("");
    setLiveTools([]);
    setStatusText("");
    streamRef.current = "";
    toolsRef.current = [];
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;

    // Local shortcut: run a raw terminal command straight from the chat box.
    if (lower.startsWith("!") || lower.startsWith(">") || lower.startsWith("$")) {
      const cmd = content.slice(1).trim();
      try {
        const result = await api.systemCmd.runCommand(cmd);
        let response = `**Command:** \`${cmd}\`\n`;
        response += `**Exit Code:** ${result.exit_code ?? "N/A"}\n`;
        if (result.stdout) response += `\n**Output:**\n\`\`\`\n${result.stdout.slice(0, 4000)}\n\`\`\``;
        if (result.stderr) response += `\n**Errors:**\n\`\`\`\n${result.stderr.slice(0, 2000)}\n\`\`\``;
        if (result.error) response += `\n**Error:** ${result.error}`;
        setMessages(prev => [...prev, { role: "assistant", content: response }]);
      } catch (e: any) {
        setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e.message || "Unknown error"}` }]);
      }
      setThinking(false);
      return;
    }

    try {
      const history = messages
        .filter(m => m.role === "user" || m.role === "assistant")
        .slice(-16)
        .map(m => ({ role: m.role, content: m.content }));
      const context = ctxKind && ctxName ? { kind: ctxKind, name: ctxName } : null;
      const res = await api.ai.chat([...history, { role: "user", content }], context);
      const finalText = streamRef.current || res?.reply || "";
      const toolsUsed = toolsRef.current.length ? [...toolsRef.current] : undefined;
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: finalText, tools: toolsUsed },
      ]);
      if (res?.error) setStatusText(res.error);
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Something went wrong while contacting the AI: ${e?.message || e}\n\nYou can still use \`!command\` in this chat or the Terminal tab for direct system commands.`,
      }]);
    }
    setThinking(false);
    setStreamText("");
    loadWorkspaces();
  };

  const setWorkspace = (kind: string, name: string) => {
    setCtxKind(kind);
    setCtxName(name);
  };

  const quickPrompts = [
    "Create a Paper server called ForizCart for 1.21.11 with the default MOTD on port 25579",
    "Install ViaVersion into ForizCart",
    "Add Notch to the whitelist",
    "Broadcast 'Server restarting in 1 minute'",
    "Backup my current server",
    "Reset the world of the current server",
    "Go to the Servers page",
    "Show me my system info",
  ];
  const tabs: { id: TabType; label: string; icon: any; color: string }[] = [
    { id: "chat", label: "AI Chat", icon: Bot, color: themeColors.purple || themeColors.accent },
    { id: "terminal", label: "Terminal", icon: Terminal, color: themeColors.success },
    { id: "files", label: "File Manager", icon: Folder, color: themeColors.blue },
    { id: "crash", label: "Crash Analyzer", icon: AlertTriangle, color: themeColors.warn },
  ];

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <Bot size={20} style={{ color: themeColors.purple || themeColors.accent }} />
        <div>
          <h1 className="tinycaps text-xl font-bold gradient-text" style={{ "--accent": themeColors.purple || themeColors.accent, "--accent2": themeColors.accent } as any}>Xryloth AI Assistant</h1>
          <p className="text-xs mt-0.5" style={{ color: themeColors.text_muted }}>208 real tools — servers, console, players, plugins, mods, files, settings &amp; navigation</p>
        </div>
      </div>

      <div className="flex gap-2 mb-3 overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 shrink-0"
              style={{
                background: activeTab === tab.id ? `${tab.color}20` : "transparent",
                color: activeTab === tab.id ? tab.color : themeColors.text_muted,
                border: `1px solid ${activeTab === tab.id ? `${tab.color}30` : themeColors.border}`,
              }}>
              <Icon size={12} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* AI CHAT TAB */}
      {activeTab === "chat" && (
        <GlassCard className="flex-1 flex flex-col overflow-hidden">
          {/* Workspace selector: tells the AI which server / profile to act on */}
          <div className="flex items-center gap-2 p-2 flex-wrap" style={{ borderBottom: `1px solid ${themeColors.border}` }}>
            <span className="text-[10px] tinycaps shrink-0" style={{ color: themeColors.text_muted }}>Workspace</span>
            <div className="w-40 shrink-0">
              <Select value={ctxKind} onChange={(v) => setWorkspace(v, "")} placeholder="No target"
                options={[{ value: "", label: "No target (launcher-wide)" }, { value: "server", label: "Server…" }, { value: "instance", label: "Profile…" }]} />
            </div>
            {ctxKind === "server" && (
              <div className="w-52 shrink-0">
                <Select value={ctxName} onChange={(v) => setWorkspace("server", v)} placeholder="Pick a server…"
                  options={serverList.map((sv) => ({ value: sv.name, label: `${sv.name} · ${sv.version}` }))} />
              </div>
            )}
            {ctxKind === "instance" && (
              <div className="w-52 shrink-0">
                <Select value={ctxName} onChange={(v) => setWorkspace("instance", v)} placeholder="Pick a profile…"
                  options={instanceList.map((inst) => ({ value: inst.name, label: `${inst.name} · ${inst.version}` }))} />
              </div>
            )}
            {ctxKind && ctxName && (
              <button onClick={() => setWorkspace("", "")} className="text-[10px] px-2 py-0.5 rounded-md shrink-0"
                style={{ background: `${themeColors.accent}15`, color: themeColors.accent, border: `1px solid ${themeColors.accent}30` }}>
                clear
              </button>
            )}
            <button onClick={loadWorkspaces} className="p-1 rounded shrink-0 ml-auto" style={{ color: themeColors.text_muted }} title="Refresh lists">
              <RefreshCw size={12} />
            </button>
          </div>

          <div ref={chatRef} className="flex-1 overflow-y-auto space-y-3 p-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`flex gap-2 max-w-[88%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: msg.role === "user" ? `${themeColors.accent}20` : `${themeColors.purple || themeColors.accent}20` }}>
                    {msg.role === "user" ? <User size={12} style={{ color: themeColors.accent }} /> : <Sparkles size={12} style={{ color: themeColors.purple || themeColors.accent }} />}
                  </div>
                  <div className="px-3 py-2 rounded-lg text-xs"
                    style={{
                      background: msg.role === "user" ? `${themeColors.accent}15` : themeColors.bg_card2,
                      color: themeColors.text_main,
                      border: `1px solid ${themeColors.border}`,
                    }}>
                    <Markdown text={msg.content} tc={themeColors} />
                    {msg.tools && msg.tools.length > 0 && (
                      <div className="mt-2 pt-2 flex flex-wrap gap-1" style={{ borderTop: `1px solid ${themeColors.border}` }}>
                        {msg.tools.map((t, j) => (
                          <span key={j} className="text-[9px] px-1.5 py-0.5 rounded font-mono flex items-center gap-1"
                            style={{
                              background: t.status === "error" ? `${themeColors.danger}15` : `${themeColors.accent}12`,
                              color: t.status === "error" ? themeColors.danger : themeColors.accent,
                              border: `1px solid ${t.status === "error" ? themeColors.danger : themeColors.accent}25`,
                            }}>
                            <CheckCircle2 size={8} /> {t.tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Live streaming reply + tool activity */}
            {thinking && (
              <div className="flex justify-start">
                <div className="flex gap-2 max-w-[88%]">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: `${themeColors.purple || themeColors.accent}20` }}>
                    <Sparkles size={12} style={{ color: themeColors.purple || themeColors.accent }} />
                  </div>
                  <div className="px-3 py-2 rounded-lg text-xs min-w-0"
                    style={{ background: themeColors.bg_card2, border: `1px solid ${themeColors.border}` }}>
                    {liveTools.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {liveTools.map((t, j) => (
                          <span key={j} className="text-[9px] px-1.5 py-0.5 rounded font-mono flex items-center gap-1"
                            style={{
                              background: `${themeColors.accent}12`,
                              color: themeColors.accent,
                              border: `1px solid ${themeColors.accent}25`,
                            }}>
                            {t.status === "start"
                              ? <Loader2 size={8} className="animate-spin" />
                              : <CheckCircle2 size={8} />}
                            {t.tool}
                          </span>
                        ))}
                      </div>
                    )}
                    {statusText && !streamText && (
                      <p className="text-[10px] mb-1" style={{ color: themeColors.text_muted }}>{statusText}</p>
                    )}
                    {streamText
                      ? <Markdown text={streamText} tc={themeColors} />
                      : (
                        <div className="flex items-center gap-1.5" style={{ color: themeColors.text_muted }}>
                          <Loader2 size={11} className="animate-spin" />
                          <span className="text-[11px]">Thinking…</span>
                        </div>
                      )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="px-2 pt-2 flex gap-1.5 flex-wrap" style={{ borderTop: `1px solid ${themeColors.border}` }}>
            {quickPrompts.map((q) => (
              <button key={q} onClick={() => setInput(q)}
                className="px-2 py-1 rounded text-[10px] font-medium transition-all truncate max-w-full"
                style={{ background: `${themeColors.accent}10`, color: themeColors.accent, border: `1px solid ${themeColors.accent}20` }}>
                {q}
              </button>
            ))}
          </div>

          <div className="flex gap-2 p-2">
            <GlassInput value={input} onChange={setInput}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder={ctxName ? `Ask about ${ctxName}…` : "Ask Xryloth AI anything, or !command…"} />
            <GlowButton onClick={sendMessage} disabled={!input.trim() || thinking} size="sm" className="flex items-center gap-1 shrink-0">
              <Send size={14} /> Send
            </GlowButton>
          </div>
        </GlassCard>
      )}

      {/* TERMINAL TAB */}
      {activeTab === "terminal" && (
        <GlassCard className="flex-1 flex flex-col overflow-hidden">
          <div ref={terminalRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs"
            style={{ background: "#0a0a0f", color: "#e0e0e0", minHeight: 300 }}
            onClick={() => terminalInputRef.current?.focus()}>
            <div style={{ color: themeColors.success, marginBottom: 4 }}>
              Xryloth Terminal v1.0 — Type commands below
            </div>
            {terminalHistory.map((line, i) => (
              <div key={i} style={{
                color: line.startsWith("[ERROR]") ? themeColors.danger :
                       line.includes("> ") ? themeColors.success :
                       themeColors.text_sub,
                whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}>{line}</div>
            ))}
            {terminalRunning && (
              <div style={{ color: themeColors.warn }}>Running...</div>
            )}
            <div className="flex items-center gap-1" style={{ color: themeColors.success }}>
              <span>{currentPath}&gt;</span>
              <input ref={terminalInputRef}
                value={terminalInput}
                onChange={e => setTerminalInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !terminalRunning) {
                    execTerminal(terminalInput);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    if (historyIdx < commandHistory.length - 1) {
                      const newIdx = historyIdx + 1;
                      setHistoryIdx(newIdx);
                      setTerminalInput(commandHistory[newIdx] || "");
                    }
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    if (historyIdx > 0) {
                      const newIdx = historyIdx - 1;
                      setHistoryIdx(newIdx);
                      setTerminalInput(commandHistory[newIdx] || "");
                    } else {
                      setHistoryIdx(-1);
                      setTerminalInput("");
                    }
                  }
                }}
                style={{ background: "transparent", border: "none", color: "#fff", outline: "none", flex: 1, fontFamily: "monospace", fontSize: 12 }}
                autoFocus
              />
            </div>
          </div>
          <div className="flex gap-2 p-2 flex-wrap" style={{ borderTop: `1px solid ${themeColors.border}` }}>
            {quickCommands.map(qc => (
              <button key={qc.label} onClick={() => execTerminal(qc.cmd)}
                className="px-2 py-1 rounded text-[10px] font-medium transition-all flex items-center gap-1"
                style={{ background: `${themeColors.success}10`, color: themeColors.success, border: `1px solid ${themeColors.success}20` }}>
                <Play size={8} /> {qc.label}
              </button>
            ))}
            <button onClick={() => setTerminalHistory([])}
              className="px-2 py-1 rounded text-[10px] font-medium transition-all flex items-center gap-1"
              style={{ background: `${themeColors.danger}10`, color: themeColors.danger, border: `1px solid ${themeColors.danger}20` }}>
              <Trash2 size={8} /> Clear
            </button>
          </div>
        </GlassCard>
      )}

      {/* FILE MANAGER TAB */}
      {activeTab === "files" && (
        <GlassCard className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 p-2" style={{ borderBottom: `1px solid ${themeColors.border}` }}>
            <button onClick={() => {
              const parent = IS_WINDOWS
                ? currentPath.replace(/[\\\/][^\\\/]+[\\\/]?$/, "").replace(/^[^\\\/]+[\\\/]?/, "C:\\")
                : (currentPath.replace(/\/[^\/]+\/?$/, "") || "/");
              if (parent !== currentPath) loadDir(parent || ROOT_PATH);
            }}
              className="p-1 rounded" style={{ color: themeColors.text_muted }}>
              <ArrowUp size={14} />
            </button>
            <div className="flex-1 flex items-center gap-1 px-2 py-1 rounded text-xs font-mono"
              style={{ background: themeColors.bg_card2, color: themeColors.text_main, border: `1px solid ${themeColors.border}` }}>
              <FolderOpen size={12} style={{ color: themeColors.blue }} />
              {currentPath}
            </div>
            <button onClick={() => loadDir(currentPath)} className="p-1 rounded" style={{ color: themeColors.text_muted }}>
              <RefreshCw size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto" style={{ maxHeight: 300 }}>
            {fileLoading ? (
              <div className="p-4 text-center text-xs" style={{ color: themeColors.text_muted }}>Loading...</div>
            ) : (
              <div className="divide-y" style={{ borderColor: themeColors.border }}>
                {dirEntries.map(entry => (
                  <div key={entry.name}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:opacity-80 cursor-pointer transition-all"
                    style={{ color: themeColors.text_main }}
                    onClick={() => {
                      if (entry.is_dir) loadDir(entry.path);
                    }}>
                    {entry.is_dir ? (
                      <Folder size={14} style={{ color: themeColors.blue }} />
                    ) : (
                      <File size={14} style={{ color: themeColors.text_muted }} />
                    )}
                    <span className="flex-1 truncate font-mono">{entry.name}</span>
                    {!entry.is_dir && <span style={{ color: themeColors.text_muted }}>{formatSize(entry.size)}</span>}
                    {!entry.is_dir && (
                      <div className="flex gap-1">
                        <button onClick={(e) => { e.stopPropagation(); readFile(entry.path); }}
                          className="p-1 rounded hover:opacity-70" style={{ color: themeColors.success }}>
                          <FileText size={12} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(entry.path); }}
                          className="p-1 rounded hover:opacity-70" style={{ color: themeColors.text_muted }}>
                          <Copy size={12} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); deleteFileOrDir(entry.path); }}
                          className="p-1 rounded hover:opacity-70" style={{ color: themeColors.danger }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                    {entry.is_dir && (
                      <button onClick={(e) => { e.stopPropagation(); deleteFileOrDir(entry.path); }}
                        className="p-1 rounded hover:opacity-70" style={{ color: themeColors.danger }}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {editingFile && (
            <div style={{ borderTop: `1px solid ${themeColors.border}` }}>
              <div className="flex items-center gap-2 p-2">
                <FileText size={12} style={{ color: themeColors.success }} />
                <span className="text-xs truncate font-mono flex-1" style={{ color: themeColors.text_main }}>{editingFile}</span>
                <GlowButton size="sm" onClick={saveFile} className="text-[10px]">Save</GlowButton>
                <button onClick={() => { setEditingFile(""); setFileContent(""); }}
                  className="text-[10px]" style={{ color: themeColors.danger }}>Close</button>
              </div>
              <textarea value={fileContent} onChange={e => setFileContent(e.target.value)}
                className="w-full p-2 font-mono text-xs outline-none resize-none"
                style={{ background: themeColors.bg_card2, color: themeColors.text_main, minHeight: 120, maxHeight: 200, borderTop: `1px solid ${themeColors.border}` }}
              />
            </div>
          )}

          <div className="p-2" style={{ borderTop: `1px solid ${themeColors.border}` }}>
            <div className="flex gap-2">
              <GlassInput value={currentPath} onChange={setCurrentPath}
                onKeyDown={(e) => e.key === "Enter" && loadDir(currentPath)}
                placeholder="Enter path..." />
              <GlowButton onClick={() => loadDir(currentPath)} size="sm" className="flex items-center gap-1 shrink-0">
                <FolderOpen size={12} /> Go
              </GlowButton>
            </div>
          </div>
        </GlassCard>
      )}

      {/* CRASH ANALYZER TAB */}
      {activeTab === "crash" && (
        <GlassCard>
          <div className="flex items-center gap-2 mb-3">
            <Wrench size={16} style={{ color: themeColors.warn }} />
            <h3 className="tinycaps text-sm font-semibold" style={{ color: themeColors.text_main }}>Crash Log Analyzer</h3>
          </div>
          <p className="text-xs mb-3" style={{ color: themeColors.text_muted }}>
            Analyze crash logs from your Minecraft instances. Select an instance to scan.
          </p>
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <Select value={crashInstance} onChange={setCrashInstance}
                placeholder="Select instance..."
                options={[
                  { value: "", label: "Select instance..." },
                  ...crashInstances.filter((i: any) => i.installed).map((i: any) => ({ value: i.name, label: i.name })),
                ]} />
            </div>
            <GlowButton size="sm" onClick={async () => {
              if (!crashInstance) return;
              setAnalyzingCrash(true);
              setCrashResult(null);
              try {
                const result = await api.crashLog.analyze(crashInstance);
                setCrashResult(result);
              } catch {}
              setAnalyzingCrash(false);
            }} disabled={!crashInstance || analyzingCrash} className="flex items-center gap-1 shrink-0">
              <Search size={12} /> {analyzingCrash ? "Analyzing..." : "Analyze"}
            </GlowButton>
          </div>
          {crashResult && (
            <div className="space-y-3">
              {(crashResult as any).crash_count > 0 ? (
                <div className="px-3 py-2 rounded-lg" style={{ background: `${themeColors.warn}10`, border: `1px solid ${themeColors.warn}20` }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle size={12} style={{ color: themeColors.warn }} />
                    <span className="text-xs font-semibold" style={{ color: themeColors.warn }}>
                      Found {(crashResult as any).crash_count} crash log(s)
                    </span>
                    {(crashResult as any).crash_file && (
                      <span className="text-[10px]" style={{ color: themeColors.text_muted }}>
                        — {(crashResult as any).crash_file}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="px-3 py-2 rounded-lg" style={{ background: `${themeColors.success}10`, border: `1px solid ${themeColors.success}20` }}>
                  <span className="text-xs" style={{ color: themeColors.success }}>No crash logs found for this instance.</span>
                </div>
              )}
              {(crashResult as any).crash_log && (
                <div>
                  <h4 className="text-xs font-semibold mb-1" style={{ color: themeColors.text_main }}>Crash Log</h4>
                  <pre className="text-[10px] p-3 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap"
                    style={{ background: themeColors.bg_card2, color: themeColors.text_sub, border: `1px solid ${themeColors.border}` }}>
                    {(crashResult as any).crash_log}
                  </pre>
                </div>
              )}
              {(crashResult as any).recent_errors && (crashResult as any).recent_errors.trim() && (
                <div>
                  <h4 className="text-xs font-semibold mb-1" style={{ color: themeColors.text_main }}>Recent Errors</h4>
                  <pre className="text-[10px] p-3 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap"
                    style={{ background: themeColors.bg_card2, color: themeColors.danger, border: `1px solid ${themeColors.border}` }}>
                    {(crashResult as any).recent_errors}
                  </pre>
                </div>
              )}
              {(crashResult as any).crash_log && (
                <GlowButton size="sm" onClick={async () => {
                  setMessages(prev => [...prev, { role: "user", content: "Auto-fix: Kill stuck Java processes and flush DNS" }]);
                  const killCmd = IS_WINDOWS
                    ? "taskkill /F /IM javaw.exe 2>nul & taskkill /F /IM java.exe 2>nul"
                    : "pkill -f javaw; pkill -f java";
                  const r1 = await api.systemCmd.runCommand(killCmd);
                  let fixResponse = "**Auto-Fix Results:**\n\n";
                  fixResponse += `**Kill Java:** ${r1.success ? "Done" : r1.error || "No processes found"}\n`;
                  if (IS_WINDOWS) {
                    const r2 = await api.systemCmd.runCommand("ipconfig /flushdns");
                    fixResponse += `**Flush DNS:** ${r2.stdout || r2.error || "Done"}\n`;
                  } else {
                    fixResponse += `**Flush DNS:** skipped (Linux/macOS)\n`;
                  }
                  fixResponse += `\nTry launching the game again.`;
                  setMessages(prev => [...prev, { role: "assistant", content: fixResponse }]);
                  setActiveTab("chat");
                }} variant="secondary" className="flex items-center gap-1">
                  <Wrench size={12} /> Auto-Fix & Relaunch
                </GlowButton>
              )}
            </div>
          )}
        </GlassCard>
      )}
    </div>
  );
}
