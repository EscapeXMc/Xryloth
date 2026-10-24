import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLauncherStore } from "../../stores";
import { GlassCard } from "../ui/GlassCard";
import { GlowButton } from "../ui/GlowButton";
import { GlassInput } from "../ui/FormControls";
import {
  MessageSquare, Send, LogOut, Upload, UserPlus, Users,
  Circle, Clock, Swords, ChevronDown, X, AtSign, Bell,
  Search, Hash, MessageCircle, CheckCheck, Smile,
  Filter, ChevronLeft, ChevronRight, Plus, Settings,
  Mail, Inbox, Tag,
} from "lucide-react";
import {
  auth,
  onAuthStateChanged,
  updateProfile,
} from "../../lib/firebase";
import {
  registerUser,
  loginUser,
  logoutUser,
  uploadProfileImage,
  sendMessage,
  subscribeToMessages,
  subscribeToOnlineUsers,
  setupPresence,
  sendInvite,
  extractMentions,
  subscribeToChannels,
  createChannel,
  joinChannel,
  sendDM,
  markMessagesAsRead,
  addReaction,
  searchMessages,
  subscribeToDMs,
  subscribeToMessagesByChannel,
  getUserByUsername,
} from "../../lib/chatService";
import type { ChatUser, ChatMessage, ChatChannel } from "../../lib/chatService";
import { invoke } from "@tauri-apps/api/tauri";

const STEVE_HEAD = "https://mc-heads.net/avatar/Steve/64";

let pingAudioCtx: AudioContext | null = null;
function playPingSound() {
  try {
    if (!pingAudioCtx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      pingAudioCtx = new Ctx();
    }
    const ctx = pingAudioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.6;
    masterGain.connect(ctx.destination);
    // Discord-like ping: quick attack, layered harmonics
    const frequencies = [660, 880, 1100, 1320];
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i < 2 ? "sine" : "triangle";
      osc.frequency.value = freq;
      const start = t + i * 0.04;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(masterGain);
      osc.start(start);
      osc.stop(start + 0.4);
    });
    // Sub-bass thump
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = "sine";
    subOsc.frequency.value = 120;
    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    subOsc.connect(subGain).connect(masterGain);
    subOsc.start(t);
    subOsc.stop(t + 0.25);
  } catch {}
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export function ChatPage() {
  const { themeColors } = useLauncherStore();

  const [user, setUser] = useState<ChatUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Auth form
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<ChatUser[]>([]);
  const [inputText, setInputText] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteAddress, setInviteAddress] = useState("");
  const [invitePort, setInvitePort] = useState("25565");
  const [inviteVersion, setInviteVersion] = useState("1.20.4");

  // Mention state
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [pingToast, setPingToast] = useState<{ id: string; from: string; text: string } | null>(null);
  const seenPingRef = useRef<Set<string>>(new Set());

  // Chat enhancements state
  const [activeChannel, setActiveChannel] = useState<string>("general");
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [showChannels, setShowChannels] = useState(true);
  const [showDMs, setShowDMs] = useState(false);
  const [dmTarget, setDmTarget] = useState<string>("");
  const [dmMessages, setDmMessages] = useState<ChatMessage[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDesc, setNewChannelDesc] = useState("");
  const [newDMUser, setNewDMUser] = useState("");
  const [activeView, setActiveView] = useState<"chat" | "channels" | "dms">("chat");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const unsubMessagesRef = useRef<(() => void) | null>(null);
  const unsubUsersRef = useRef<(() => void) | null>(null);
  const unsubChannelsRef = useRef<(() => void) | null>(null);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        // Fetch full profile from database
        const { get, ref: dbRef, db } = await import("../../lib/firebase");
        try {
          const snap = await get(dbRef(db, `users/${fbUser.uid}`));
          if (snap.exists()) {
            setUser(snap.val());
          } else {
            // Create basic profile
            const profile: ChatUser = {
              uid: fbUser.uid,
              username: fbUser.displayName || "Unknown",
              email: fbUser.email || "",
              displayName: fbUser.displayName || "Unknown",
              photoURL: fbUser.photoURL || STEVE_HEAD,
              status: "online",
              lastSeen: Date.now(),
              createdAt: Date.now(),
            };
            const { set: dbSet } = await import("../../lib/firebase");
            await dbSet(dbRef(db, `users/${fbUser.uid}`), profile);
            setUser(profile);
          }
          setupPresence();
        } catch {
          setUser(null);
        }
      } else {
        setUser(null);
        if (unsubMessagesRef.current) {
          unsubMessagesRef.current();
          unsubMessagesRef.current = null;
        }
        if (unsubUsersRef.current) {
          unsubUsersRef.current();
          unsubUsersRef.current = null;
        }
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Subscribe to messages and users when logged in
  useEffect(() => {
    if (!user) return;

    if (activeView === "channels" && activeChannel) {
      unsubMessagesRef.current = subscribeToMessagesByChannel(setMessages, activeChannel);
    } else if (activeView === "dms" && dmTarget) {
      unsubMessagesRef.current = subscribeToDMs(setMessages, dmTarget);
    } else {
      unsubMessagesRef.current = subscribeToMessages(setMessages);
    }
    unsubUsersRef.current = subscribeToOnlineUsers(setOnlineUsers);

    return () => {
      if (unsubMessagesRef.current) unsubMessagesRef.current();
      if (unsubUsersRef.current) unsubUsersRef.current();
    };
  }, [user, activeView, activeChannel, dmTarget]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-mark messages as read when new messages arrive
  useEffect(() => {
    if (!user || messages.length === 0) return;
    const myUid = user.uid;
    const unreadIds = messages
      .filter((m) => m.uid !== myUid && (!m.readBy || !m.readBy.includes(myUid)))
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      markMessagesAsRead(unreadIds);
    }
  }, [messages, user]);

  // Ping detection: play sound + notification when someone mentions me
  useEffect(() => {
    if (!user) return;
    const myUid = user.uid;
    const myName = (user.username || "").toLowerCase();
    for (const msg of messages) {
      if (seenPingRef.current.has(msg.id)) continue;
      seenPingRef.current.add(msg.id);
      if (msg.uid === myUid || msg.type !== "message") continue;
      const mentioned = Array.isArray(msg.mentions) && msg.mentions.some(
        (m) => m.toLowerCase() === myName
      );
      if (!mentioned) continue;
      // Sound ping (Web Audio API)
      playPingSound();
      // Tauri native sound
      try {
        invoke("play_notification_sound").catch(() => {});
      } catch {}
      // Tauri native notification
      try {
        invoke("show_notification", {
          title: `@${user.username} — you were mentioned`,
          body: `${msg.username}: ${msg.text}`,
        }).catch(() => {});
      } catch {}
      // In-app toast
      setPingToast({ id: msg.id, from: msg.username, text: msg.text });
      // System notification (web fallback)
      try {
        if ("Notification" in window) {
          if (Notification.permission === "granted") {
            new Notification(`@${user.username} — you were mentioned`, { body: `${msg.username}: ${msg.text}` });
          } else if (Notification.permission !== "denied") {
            Notification.requestPermission();
          }
        }
      } catch {}
    }
  }, [messages, user]);

  // Auto-dismiss ping toast
  useEffect(() => {
    if (!pingToast) return;
    const t = setTimeout(() => setPingToast(null), 5000);
    return () => clearTimeout(t);
  }, [pingToast]);

  // Subscribe to channels
  useEffect(() => {
    if (activeView === "channels") {
      unsubChannelsRef.current = subscribeToChannels(setChannels);
    }
    return () => {
      if (unsubChannelsRef.current) unsubChannelsRef.current();
    };
  }, [activeView]);

  // Auth handlers
  const handleAuth = async () => {
    setAuthError("");
    setAuthLoading(true);

    if (isRegister) {
      if (!username.trim()) {
        setAuthError("Username is required");
        setAuthLoading(false);
        return;
      }
      if (username.length < 3 || username.length > 20) {
        setAuthError("Username must be 3-20 characters");
        setAuthLoading(false);
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        setAuthError("Username: letters, numbers, underscores only");
        setAuthLoading(false);
        return;
      }
      const result = await registerUser(email, password, username);
      if (!result.success) {
        setAuthError(result.error || "Registration failed");
      }
    } else {
      const result = await loginUser(email, password);
      if (!result.success) {
        setAuthError(result.error || "Login failed");
      }
    }

    setAuthLoading(false);
  };

  const handleLogout = async () => {
    await logoutUser();
    setUser(null);
    setMessages([]);
    setOnlineUsers([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionCandidates.length > 0 && mentionQuery) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMention(mentionCandidates[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery("");
        setMentionIndex(0);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (value: string) => {
    setInputText(value);
    // Detect @mention being typed (must be at start or after whitespace)
    const match = value.match(/(^|\s)@([a-zA-Z0-9_]*)$/);
    setMentionQuery(match ? match[2] : "");
    setMentionIndex(0);
  };

  const mentionCandidates = mentionQuery
    ? onlineUsers
        .filter((u) => u.uid !== user?.uid)
        .filter((u) =>
          u.username.toLowerCase().includes(mentionQuery.toLowerCase())
        )
        .slice(0, 8)
    : [];

  const selectMention = (target: ChatUser) => {
    if (!mentionQuery) return;
    setInputText((prev) => {
      const idx = prev.lastIndexOf("@");
      return prev.slice(0, idx) + `@${target.username} `;
    });
    setMentionQuery("");
    setMentionIndex(0);
    inputRef.current?.focus();
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    // Check for /invite command
    if (text.startsWith("/invite ")) {
      const parts = text.slice(8).split(" ");
      if (parts.length >= 1) {
        setInviteUsername(parts[0]);
        if (parts[1]) setInviteAddress(parts[1]);
        if (parts[2]) setInvitePort(parts[2]);
        if (parts[3]) setInviteVersion(parts[3]);
        setShowInvite(true);
        setInputText("");
        return;
      }
    }

    // Check for /dm command
    if (text.startsWith("/dm ") && activeView === "dms") {
      const parts = text.slice(4).split(" ");
      const targetUsername = parts[0];
      const dmText = parts.slice(1).join(" ");
      if (targetUsername && dmText) {
        setSending(true);
        try {
          const result = await sendDM(targetUsername, dmText);
          if (!result.success) {
            setSendError(result.error || "Failed to send DM");
          }
          setInputText("");
        } catch (err: any) {
          setSendError(err?.message || "Failed to send DM");
        }
        setSending(false);
        return;
      }
    }

    setSending(true);
    setSendError("");
    try {
      const mentions = extractMentions(text);
      await sendMessage(
        text,
        "message",
        undefined,
        mentions,
        undefined,
        activeView === "channels" ? activeChannel : undefined,
      );
      setInputText("");
      setMentionQuery("");
      inputRef.current?.focus();
    } catch (err: any) {
      setSendError(err?.message || "Failed to send. Check Firebase Database rules.");
    }
    setSending(false);
  };

  const handleSendInvite = async () => {
    if (!inviteUsername.trim() || !inviteAddress.trim()) return;
    setSending(true);
    try {
      const result = await sendInvite(
        inviteUsername.trim(),
        inviteAddress.trim(),
        parseInt(invitePort, 10) || 25565,
        inviteVersion || "1.20.4"
      );
      if (!result.success) {
        await sendMessage(`Failed to send invite: ${result.error}`, "system");
      }
      setShowInvite(false);
      setInviteUsername("");
      setInviteAddress("");
      setInvitePort("25565");
      setInviteVersion("1.20.4");
    } catch {
      // silent
    }
    setSending(false);
  };

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Image must be under 5MB");
      return;
    }
    const result = await uploadProfileImage(file);
    if (result.success && result.url && user) {
      setUser({ ...user, photoURL: result.url });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

const currentUser = user as ChatUser;
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            className="w-8 h-8 rounded-full mx-auto mb-3"
            style={{
              border: `2px solid ${themeColors.border}`,
              borderTopColor: themeColors.accent,
            }}
          />
          <p className="tinycaps text-xs" style={{ color: themeColors.text_muted }}>
            Loading chat...
          </p>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarUpload}
        />
        <GlassCard className="w-full max-w-sm p-6">
          <div className="text-center mb-6">
            <div
              className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${themeColors.accent}25, ${themeColors.purple || themeColors.blue}20)`,
                border: `1px solid ${themeColors.accent}30`,
              }}
            >
              <MessageSquare size={28} style={{ color: themeColors.accent }} />
            </div>
            <h2
              className="tinycaps text-lg font-bold gradient-text"
              style={
                {
                  "--accent": themeColors.accent,
                  "--accent2": themeColors.purple || themeColors.blue,
                } as any
              }
            >
              EC Chat
            </h2>
            <p className="text-xs mt-1" style={{ color: themeColors.text_muted }}>
              {isRegister ? "Create an account to join the chat" : "Sign in to chat with other players"}
            </p>
          </div>

          <div className="space-y-3">
            {isRegister && (
              <div>
                <label className="text-[10px] font-medium mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>
                  Username
                </label>
                <GlassInput
                  value={username}
                  onChange={setUsername}
                  onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                  placeholder="Your display name"
                />
              </div>
            )}
            <div>
              <label className="text-[10px] font-medium mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>
                Email
              </label>
              <GlassInput
                value={email}
                onChange={setEmail}
                onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                placeholder="you@example.com"
                type="email"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium mb-1 block tinycaps" style={{ color: themeColors.text_sub }}>
                Password
              </label>
              <GlassInput
                value={password}
                onChange={setPassword}
                onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                placeholder="••••••••"
                type="password"
              />
            </div>

            {authError && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-[11px] px-3 py-2 rounded-xl"
                style={{
                  background: `${themeColors.danger}15`,
                  color: themeColors.danger,
                  border: `1px solid ${themeColors.danger}30`,
                }}
              >
                {authError}
              </motion.p>
            )}

            <GlowButton
              fullWidth
              onClick={handleAuth}
              disabled={authLoading}
            >
              {authLoading
                ? "Please wait..."
                : isRegister
                  ? "Create Account"
                  : "Sign In"}
            </GlowButton>

            <button
              onClick={() => {
                setIsRegister(!isRegister);
                setAuthError("");
              }}
              className="w-full text-center text-[11px] tinycaps font-medium cursor-pointer py-1"
              style={{ color: themeColors.text_sub, background: "none", border: "none" }}
            >
              {isRegister
                ? "Already have an account? Sign in"
                : "Don't have an account? Register"}
            </button>
          </div>
        </GlassCard>
      </div>
    );
  }

  // ── Chat Interface ──
  const onlineCount = onlineUsers.filter((u) => u.status === "online").length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarUpload}
      />

{/* Top Bar */}
       <GlassCard className="shrink-0 flex items-center justify-between px-4 py-2.5 rounded-xl mb-3">
         <div className="flex items-center gap-3">
           <div className="flex items-center gap-2">
             <MessageSquare size={18} style={{ color: themeColors.accent }} />
             <h1
               className="tinycaps text-base font-bold gradient-text"
               style={
                 {
                   "--accent": themeColors.accent,
                   "--accent2": themeColors.purple || themeColors.blue,
                 } as any
               }
             >
               Chat
             </h1>
           </div>
           <div
             className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-lg"
             style={{
               background: `${themeColors.success}12`,
               color: themeColors.success,
               border: `1px solid ${themeColors.success}25`,
             }}
           >
             <Circle size={6} fill={themeColors.success} />
             {onlineCount} online
           </div>
         </div>

         <div className="flex items-center gap-2">
           {/* View tabs */}
           <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: themeColors.bg_card2 }}>
             <button
               onClick={() => setActiveView("chat")}
               className={`tinycaps text-[10px] px-2 py-1 rounded-lg transition-colors cursor-pointer ${activeView === "chat" ? "font-bold" : ""}`}
               style={{
                 background: activeView === "chat" ? `${themeColors.accent}20` : "transparent",
                 color: activeView === "chat" ? themeColors.accent : themeColors.text_muted,
               }}
             >
               <MessageSquare size={10} className="inline mr-1" /> Chat
             </button>
             <button
               onClick={() => setActiveView("channels")}
               className={`tinycaps text-[10px] px-2 py-1 rounded-lg transition-colors cursor-pointer ${activeView === "channels" ? "font-bold" : ""}`}
               style={{
                 background: activeView === "channels" ? `${themeColors.accent}20` : "transparent",
                 color: activeView === "channels" ? themeColors.accent : themeColors.text_muted,
               }}
             >
               <Hash size={10} className="inline mr-1" /> Channels
             </button>
             <button
               onClick={() => setActiveView("dms")}
               className={`tinycaps text-[10px] px-2 py-1 rounded-lg transition-colors cursor-pointer ${activeView === "dms" ? "font-bold" : ""}`}
               style={{
                 background: activeView === "dms" ? `${themeColors.accent}20` : "transparent",
                 color: activeView === "dms" ? themeColors.accent : themeColors.text_muted,
               }}
             >
               <Mail size={10} className="inline mr-1" /> DMs
             </button>
           </div>

           {/* Search */}
           <button
             onClick={() => setShowSearch(!showSearch)}
             className="p-2 rounded-xl transition-colors cursor-pointer"
             style={{
               background: showSearch ? `${themeColors.accent}15` : "transparent",
               color: showSearch ? themeColors.accent : themeColors.text_muted,
             }}
             title="Search messages"
           >
             <Search size={14} />
           </button>

           {/* DM button */}
           <button
             onClick={() => setShowDMs(true)}
             className="p-2 rounded-xl transition-colors cursor-pointer"
             style={{
               background: `${themeColors.blue}15`,
               color: themeColors.blue,
             }}
             title="New DM"
           >
             <Mail size={14} />
           </button>

           <motion.button
             whileHover={{ scale: 1.1 }}
             whileTap={{ scale: 0.9 }}
             onClick={handleAvatarClick}
             className="relative cursor-pointer"
             title="Change avatar"
           >
             <img
               src={currentUser.photoURL || STEVE_HEAD}
               alt=""
               className="w-7 h-7 rounded-lg object-cover"
               style={{ border: `2px solid ${themeColors.accent}40` }}
               onError={(e) => {
                 (e.target as HTMLImageElement).src = STEVE_HEAD;
               }}
             />
             <div
               className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center"
               style={{
                 background: themeColors.bg_card,
                 border: `1.5px solid ${themeColors.success}`,
               }}
             >
               <Upload size={6} style={{ color: themeColors.success }} />
             </div>
           </motion.button>
           <span
             className="tinycaps text-[11px] font-bold"
             style={{ color: themeColors.text_main }}
           >
             {currentUser.username}
           </span>
           <GlowButton size="sm" variant="secondary" onClick={handleLogout} className="flex items-center gap-1">
             <LogOut size={11} /> Logout
           </GlowButton>
         </div>
       </GlassCard>

{/* Search Bar */}
       {showSearch && (
         <GlassCard className="shrink-0 rounded-xl px-4 py-2 mb-3 flex items-center gap-3">
           <Search size={14} style={{ color: themeColors.text_muted }} />
           <GlassInput
             value={searchQuery}
             onChange={(v) => {
               setSearchQuery(v);
               if (v.trim()) {
                 setSearchResults(searchMessages(v.trim(), messages));
               } else {
                 setSearchResults([]);
               }
             }}
             placeholder="Search messages..."
             className="flex-1"
           />
           <button
             onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults([]); }}
             className="p-1 rounded-lg transition-colors cursor-pointer"
             style={{ color: themeColors.text_muted }}
           >
             <X size={14} />
           </button>
         </GlassCard>
       )}

{/* Main Chat Area */}
       <div className="flex-1 flex gap-3 min-h-0">
         {/* Channel/DM Sidebar */}
         {(activeView === "channels" || activeView === "dms") && (
           <div className="w-52 shrink-0">
             <GlassCard className="h-full rounded-xl p-0 overflow-hidden flex flex-col">
               <div
                 className="px-3 py-2.5 flex items-center gap-1.5 shrink-0"
                 style={{ borderBottom: `1px solid ${themeColors.border}` }}
               >
                 {activeView === "channels" ? (
                   <>
                     <Hash size={13} style={{ color: themeColors.accent }} />
                     <span className="tinycaps text-[11px] font-bold" style={{ color: themeColors.text_main }}>Channels</span>
                     <button
                       onClick={() => setShowChannelModal(true)}
                       className="ml-auto p-1 rounded-lg transition-colors cursor-pointer"
                       style={{ color: themeColors.accent }}
                       title="Create channel"
                     >
                       <Plus size={12} />
                     </button>
                   </>
                 ) : (
                   <>
                     <Mail size={13} style={{ color: themeColors.blue }} />
                     <span className="tinycaps text-[11px] font-bold" style={{ color: themeColors.text_main }}>Direct Messages</span>
                   </>
                 )}
               </div>

               <div className="flex-1 overflow-y-auto py-1.5" style={{ scrollbarWidth: "thin" }}>
                 {activeView === "channels" ? (
                   channels.length === 0 ? (
                     <div className="px-3 py-6 text-center">
                       <Hash size={18} className="mx-auto mb-1" style={{ color: themeColors.text_muted, opacity: 0.4 }} />
                       <p className="text-[10px]" style={{ color: themeColors.text_muted }}>No channels yet</p>
                     </div>
                   ) : (
                     channels.map((ch) => (
                       <button
                         key={ch.id}
                         onClick={() => { setActiveChannel(ch.id); setActiveView("chat"); }}
                         className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer ${activeChannel === ch.id ? "" : ""}`}
                         style={{
                           background: activeChannel === ch.id ? `${themeColors.accent}12` : "transparent",
                         }}
                         onMouseEnter={(e) => {
                           if (activeChannel !== ch.id) e.currentTarget.style.background = `${themeColors.bg_hover}`;
                         }}
                         onMouseLeave={(e) => {
                           if (activeChannel !== ch.id) e.currentTarget.style.background = "transparent";
                         }}
                       >
                         <Hash size={10} style={{ color: themeColors.text_muted }} />
                         <span className="tinycaps text-[11px] font-medium truncate" style={{ color: themeColors.text_main }}>
                           {ch.name}
                         </span>
                       </button>
                     ))
                   )
                 ) : (
                   onlineUsers
                     .filter((u) => u.uid !== user?.uid)
                     .map((u) => (
                       <button
                         key={u.uid}
                         onClick={() => { setDmTarget(u.uid); setActiveView("chat"); }}
                         className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer ${dmTarget === u.uid ? "" : ""}`}
                         style={{
                           background: dmTarget === u.uid ? `${themeColors.accent}12` : "transparent",
                         }}
                         onMouseEnter={(e) => {
                           if (dmTarget !== u.uid) e.currentTarget.style.background = `${themeColors.bg_hover}`;
                         }}
                         onMouseLeave={(e) => {
                           if (dmTarget !== u.uid) e.currentTarget.style.background = "transparent";
                         }}
                       >
                         <div className="relative shrink-0">
                           <img
                             src={u.photoURL || STEVE_HEAD}
                             alt=""
                             className="w-6 h-6 rounded-md object-cover"
                             style={{ border: `1.5px solid ${u.status === "online" ? themeColors.success : themeColors.text_muted}40` }}
                             onError={(e) => { (e.target as HTMLImageElement).src = STEVE_HEAD; }}
                           />
                           <div
                             className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full"
                             style={{
                               background: u.status === "online" ? themeColors.success : themeColors.text_muted,
                               border: `1.5px solid ${themeColors.bg_card}`,
                             }}
                           />
                         </div>
                         <span className="tinycaps text-[11px] font-medium truncate" style={{ color: themeColors.text_main }}>
                           {u.username}
                         </span>
                       </button>
                     ))
                 )}
               </div>
             </GlassCard>
           </div>
         )}

         {/* Messages Column */}
         <div className="flex-1 flex flex-col min-w-0">
          <GlassCard className="flex-1 flex flex-col min-h-0 rounded-xl p-0 overflow-hidden">
            {/* Message Feed */}
            <div
              className="flex-1 overflow-y-auto px-4 py-3 space-y-1"
              style={{ scrollbarWidth: "thin" }}
            >
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-60">
                  <MessageSquare
                    size={32}
                    style={{ color: themeColors.text_muted }}
                  />
                  <p
                    className="text-xs mt-2 tinycaps"
                    style={{ color: themeColors.text_muted }}
                  >
                    No messages yet. Say hello!
                  </p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {messages.map((msg) => (
                    <MessageBubble
                      key={msg.id}
                      msg={msg}
                      isOwn={msg.uid === currentUser.uid}
                      themeColors={themeColors}
                      onReact={(emoji, msgId) => {
                        addReaction(msgId, emoji).catch(() => {});
                      }}
                      searchQuery={searchQuery}
                      myUid={user?.uid || ""}
                    />
                  ))}
                </AnimatePresence>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            {sendError && (
              <div className="px-4 py-1.5" style={{ background: `${themeColors.danger}15`, borderBottom: `1px solid ${themeColors.danger}30` }}>
                <p className="text-[10px] font-medium" style={{ color: themeColors.danger }}>
                  {sendError}
                </p>
              </div>
            )}
            <div
              className="px-4 py-3 flex items-center gap-2 shrink-0"
              style={{ borderTop: `1px solid ${themeColors.border}` }}
            >
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowInvite(true)}
                className="p-2 rounded-xl transition-colors shrink-0 cursor-pointer"
                style={{
                  background: `${themeColors.blue}15`,
                  color: themeColors.blue,
                  border: `1px solid ${themeColors.blue}25`,
                }}
                title="Invite player to server"
              >
                <UserPlus size={14} />
              </motion.button>

            <div className="relative flex-1">
              <GlassInput
                ref={inputRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type a message... (use @ to mention someone)"
                disabled={sending}
                className="w-full"
              />

              {/* Mention autocomplete dropdown */}
              {mentionCandidates.length > 0 && mentionQuery && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute bottom-full left-0 right-0 mb-2 z-30 overflow-hidden rounded-xl"
                  style={{
                    background: themeColors.bg_card2,
                    border: `1px solid ${themeColors.accent}30`,
                    boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 24px ${themeColors.accent}15`,
                    backdropFilter: "blur(16px)",
                  }}
                >
                  <div
                    className="px-3 py-1.5 flex items-center gap-1.5 tinycaps text-[9px] font-bold"
                    style={{ color: themeColors.text_muted, borderBottom: `1px solid ${themeColors.border}` }}
                  >
                    <AtSign size={10} style={{ color: themeColors.accent }} />
                    Mention someone
                  </div>
                  {mentionCandidates.map((u, i) => (
                    <button
                      key={u.uid}
                      onMouseEnter={() => setMentionIndex(i)}
                      onClick={() => selectMention(u)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer transition-colors"
                      style={{
                        background: i === mentionIndex ? `${themeColors.accent}15` : "transparent",
                        border: "none",
                      }}
                    >
                      <img
                        src={u.photoURL || STEVE_HEAD}
                        alt=""
                        className="w-5 h-5 rounded-md object-cover shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = STEVE_HEAD;
                        }}
                      />
                      <span
                        className="tinycaps text-[11px] font-semibold"
                        style={{ color: i === mentionIndex ? themeColors.accent : themeColors.text_main }}
                      >
                        @{u.username}
                      </span>
                      <span
                        className="ml-auto text-[9px] flex items-center gap-0.5"
                        style={{ color: themeColors.success }}
                      >
                        <Circle size={5} fill={themeColors.success} />
                        {u.status === "online" ? "online" : "offline"}
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </div>

              <GlowButton
                size="sm"
                onClick={handleSend}
                disabled={!inputText.trim() || sending}
                className="flex items-center gap-1 shrink-0"
              >
                <Send size={12} />
              </GlowButton>
            </div>
          </GlassCard>
        </div>

        {/* Online Users Sidebar */}
        <div className="w-52 shrink-0">
          <GlassCard className="h-full rounded-xl p-0 overflow-hidden flex flex-col">
            <div
              className="px-3 py-2.5 flex items-center gap-1.5 shrink-0"
              style={{ borderBottom: `1px solid ${themeColors.border}` }}
            >
              <Users size={13} style={{ color: themeColors.accent }} />
              <span
                className="tinycaps text-[11px] font-bold"
                style={{ color: themeColors.text_main }}
              >
                Online
              </span>
              <span
                className="text-[9px] ml-auto"
                style={{ color: themeColors.text_muted }}
              >
                {onlineUsers.length}
              </span>
            </div>

            <div
              className="flex-1 overflow-y-auto py-1.5"
              style={{ scrollbarWidth: "thin" }}
            >
              {onlineUsers.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <Users
                    size={18}
                    className="mx-auto mb-1"
                    style={{ color: themeColors.text_muted, opacity: 0.4 }}
                  />
                  <p
                    className="text-[10px]"
                    style={{ color: themeColors.text_muted }}
                  >
                    No users online
                  </p>
                </div>
              ) : (
                onlineUsers.map((u) => (
                  <motion.div
                    key={u.uid}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="px-2.5 py-1.5 flex items-center gap-2 mx-1 rounded-lg transition-colors"
                    style={{
                      background:
                        u.uid === currentUser.uid
                          ? `${themeColors.accent}12`
                          : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (u.uid !== currentUser.uid)
                        e.currentTarget.style.background = `${themeColors.bg_hover}`;
                    }}
                    onMouseLeave={(e) => {
                      if (u.uid !== currentUser.uid)
                        e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div className="relative shrink-0">
                      <img
                        src={u.photoURL || STEVE_HEAD}
                        alt=""
                        className="w-6 h-6 rounded-md object-cover"
                        style={{
                          border: `1.5px solid ${
                            u.status === "online"
                              ? themeColors.success
                              : themeColors.text_muted
                          }40`,
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = STEVE_HEAD;
                        }}
                      />
                      <div
                        className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                        style={{
                          background:
                            u.status === "online"
                              ? themeColors.success
                              : themeColors.text_muted,
                          border: `1.5px solid ${themeColors.bg_card}`,
                        }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[11px] font-medium truncate"
                        style={{
                          color:
                            u.uid === currentUser.uid
                              ? themeColors.accent
                              : themeColors.text_main,
                        }}
                      >
                        {u.username}
                        {u.uid === currentUser.uid && (
                          <span
                            className="text-[9px] ml-1"
                            style={{ color: themeColors.text_muted }}
                          >
                            (you)
                          </span>
                        )}
                      </p>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Ping Toast */}
      <AnimatePresence>
        {pingToast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-72"
            onClick={() => setPingToast(null)}
          >
            <GlassCard
              glow
              className="p-3 cursor-pointer"
              style={{
                border: `1px solid ${themeColors.accent}40`,
                boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 24px ${themeColors.accent}25`,
              }}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `${themeColors.accent}15`, border: `1px solid ${themeColors.accent}30` }}
                >
                  <Bell size={15} style={{ color: themeColors.accent }} />
                </div>
                <div className="min-w-0">
                  <p
                    className="tinycaps text-[11px] font-bold"
                    style={{ color: themeColors.text_main }}
                  >
                    <span style={{ color: themeColors.accent }}>@{pingToast.from}</span> mentioned you
                  </p>
                  <p
                    className="text-[11px] mt-0.5 leading-snug break-words"
                    style={{ color: themeColors.text_sub }}
                  >
                    {pingToast.text}
                  </p>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Invite Modal */}
      <AnimatePresence>
        {showInvite && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center"
            style={{
              zIndex: 9999,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(8px)",
            }}
            onClick={() => setShowInvite(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 10 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              onClick={(e) => e.stopPropagation()}
            >
              <GlassCard
                glow
                className="w-80 p-5"
                style={{
                  border: `1px solid ${themeColors.blue}30`,
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Swords size={16} style={{ color: themeColors.blue }} />
                    <h3
                      className="tinycaps text-sm font-bold"
                      style={{ color: themeColors.text_main }}
                    >
                      Invite to Server
                    </h3>
                  </div>
                  <button
                    onClick={() => setShowInvite(false)}
                    className="p-1 rounded-lg transition-colors cursor-pointer"
                    style={{ color: themeColors.text_muted }}
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label
                      className="text-[10px] font-medium mb-1 block tinycaps"
                      style={{ color: themeColors.text_sub }}
                    >
                      Username
                    </label>
                    <GlassInput
                      value={inviteUsername}
                      onChange={setInviteUsername}
                      placeholder="Target player"
                    />
                  </div>
                  <div>
                    <label
                      className="text-[10px] font-medium mb-1 block tinycaps"
                      style={{ color: themeColors.text_sub }}
                    >
                      Server Address
                    </label>
                    <GlassInput
                      value={inviteAddress}
                      onChange={setInviteAddress}
                      placeholder="e.g. mc.example.com"
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label
                        className="text-[10px] font-medium mb-1 block tinycaps"
                        style={{ color: themeColors.text_sub }}
                      >
                        Port
                      </label>
                      <GlassInput
                        value={invitePort}
                        onChange={setInvitePort}
                        placeholder="25565"
                      />
                    </div>
                    <div className="flex-1">
                      <label
                        className="text-[10px] font-medium mb-1 block tinycaps"
                        style={{ color: themeColors.text_sub }}
                      >
                        MC Version
                      </label>
                      <GlassInput
                        value={inviteVersion}
                        onChange={setInviteVersion}
                        placeholder="1.20.4"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <GlowButton
                      size="sm"
                      variant="secondary"
                      fullWidth
                      onClick={() => setShowInvite(false)}
                    >
                      Cancel
                    </GlowButton>
                    <GlowButton
                      size="sm"
                      fullWidth
                      onClick={handleSendInvite}
                      disabled={
                        sending ||
                        !inviteUsername.trim() ||
                        !inviteAddress.trim()
                      }
                      className="flex items-center gap-1"
                    >
                      <UserPlus size={11} /> Send Invite
                    </GlowButton>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          </motion.div>
)}
       </AnimatePresence>

       {/* Channel Creation Modal */}
       <AnimatePresence>
         {showChannelModal && (
           <motion.div
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             className="fixed inset-0 flex items-center justify-center"
             style={{
               zIndex: 9999,
               background: "rgba(0,0,0,0.6)",
               backdropFilter: "blur(8px)",
             }}
             onClick={() => setShowChannelModal(false)}
           >
             <motion.div
               initial={{ scale: 0.9, opacity: 0, y: 10 }}
               animate={{ scale: 1, opacity: 1, y: 0 }}
               exit={{ scale: 0.9, opacity: 0, y: 10 }}
               transition={{ type: "spring", damping: 25, stiffness: 350 }}
               onClick={(e) => e.stopPropagation()}
             >
               <GlassCard
                 glow
                 className="w-80 p-5"
                 style={{
                   border: `1px solid ${themeColors.accent}30`,
                 }}
               >
                 <div className="flex items-center justify-between mb-4">
                   <div className="flex items-center gap-2">
                     <Hash size={16} style={{ color: themeColors.accent }} />
                     <h3
                       className="tinycaps text-sm font-bold"
                       style={{ color: themeColors.text_main }}
                     >
                       Create Channel
                     </h3>
                   </div>
                   <button
                     onClick={() => setShowChannelModal(false)}
                     className="p-1 rounded-lg transition-colors cursor-pointer"
                     style={{ color: themeColors.text_muted }}
                   >
                     <X size={14} />
                   </button>
                 </div>

                 <div className="space-y-3">
                   <div>
                     <label
                       className="text-[10px] font-medium mb-1 block tinycaps"
                       style={{ color: themeColors.text_sub }}
                     >
                       Channel Name
                     </label>
                     <GlassInput
                       value={newChannelName}
                       onChange={setNewChannelName}
                       placeholder="e.g. general, builds"
                     />
                   </div>
                   <div>
                     <label
                       className="text-[10px] font-medium mb-1 block tinycaps"
                       style={{ color: themeColors.text_sub }}
                     >
                       Description
                     </label>
                     <GlassInput
                       value={newChannelDesc}
                       onChange={setNewChannelDesc}
                       placeholder="What's this channel about?"
                     />
                   </div>

                   <div className="flex gap-2 pt-1">
                     <GlowButton
                       size="sm"
                       variant="secondary"
                       fullWidth
                       onClick={() => setShowChannelModal(false)}
                     >
                       Cancel
                     </GlowButton>
                     <GlowButton
                       size="sm"
                       fullWidth
                       onClick={async () => {
                         if (!newChannelName.trim()) return;
                         const result = await createChannel(
                           newChannelName.trim(),
                           newChannelDesc.trim()
                         );
                         if (result.success && result.channelId) {
                           setActiveChannel(result.channelId);
                           setActiveView("chat");
                         }
                         setShowChannelModal(false);
                         setNewChannelName("");
                         setNewChannelDesc("");
                       }}
                       disabled={!newChannelName.trim()}
                       className="flex items-center gap-1"
                     >
                       <Plus size={11} /> Create
                     </GlowButton>
                   </div>
                 </div>
               </GlassCard>
             </motion.div>
           </motion.div>
         )}
       </AnimatePresence>

       {/* DM Quick-Open Modal */}
       <AnimatePresence>
         {showDMs && (
           <motion.div
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             className="fixed inset-0 flex items-center justify-center"
             style={{
               zIndex: 9999,
               background: "rgba(0,0,0,0.6)",
               backdropFilter: "blur(8px)",
             }}
             onClick={() => setShowDMs(false)}
           >
             <motion.div
               initial={{ scale: 0.9, opacity: 0, y: 10 }}
               animate={{ scale: 1, opacity: 1, y: 0 }}
               exit={{ scale: 0.9, opacity: 0, y: 10 }}
               transition={{ type: "spring", damping: 25, stiffness: 350 }}
               onClick={(e) => e.stopPropagation()}
             >
               <GlassCard
                 glow
                 className="w-80 p-5"
                 style={{
                   border: `1px solid ${themeColors.blue}30`,
                 }}
               >
                 <div className="flex items-center justify-between mb-4">
                   <div className="flex items-center gap-2">
                     <Mail size={16} style={{ color: themeColors.blue }} />
                     <h3
                       className="tinycaps text-sm font-bold"
                       style={{ color: themeColors.text_main }}
                     >
                       New DM
                     </h3>
                   </div>
                   <button
                     onClick={() => setShowDMs(false)}
                     className="p-1 rounded-lg transition-colors cursor-pointer"
                     style={{ color: themeColors.text_muted }}
                   >
                     <X size={14} />
                   </button>
                 </div>

                 <div className="space-y-3">
                   <div>
                     <label
                       className="text-[10px] font-medium mb-1 block tinycaps"
                       style={{ color: themeColors.text_sub }}
                     >
                       Recipient Username
                     </label>
                     <GlassInput
                       value={newDMUser}
                       onChange={setNewDMUser}
                       placeholder="e.g. senpaispider"
                     />
                   </div>

                   <div className="flex gap-2 pt-1">
                     <GlowButton
                       size="sm"
                       variant="secondary"
                       fullWidth
                       onClick={() => setShowDMs(false)}
                     >
                       Cancel
                     </GlowButton>
                     <GlowButton
                       size="sm"
                       fullWidth
                       onClick={async () => {
                         if (!newDMUser.trim()) return;
                         const targetUser = await getUserByUsername(newDMUser.trim());
                         if (targetUser) {
                           setDmTarget(targetUser.uid);
                           setActiveView("chat");
                         } else {
                           setSendError("User not found");
                         }
                         setShowDMs(false);
                         setNewDMUser("");
                       }}
                       disabled={!newDMUser.trim()}
                       className="flex items-center gap-1"
                     >
                       <Mail size={11} /> Open DM
                     </GlowButton>
                   </div>
                 </div>
               </GlassCard>
             </motion.div>
           </motion.div>
         )}
       </AnimatePresence>
     </div>
   );
 }

// ── Message Bubble Component ──
function renderMessageText(text: string, themeColors: any, searchQuery?: string) {
  if (!searchQuery) {
    const parts = text.split(/(@[a-zA-Z0-9_]+)/g);
    return parts.map((part, i) => {
      if (/^@[a-zA-Z0-9_]+$/.test(part)) {
        return (
          <span
            key={i}
            style={{
              color: themeColors.accent,
              fontWeight: 700,
              background: `${themeColors.accent}12`,
              borderRadius: 4,
              padding: "0 3px",
            }}
          >
            {part}
          </span>
        );
      }
      return part;
    });
  }
  const q = searchQuery.toLowerCase();
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, "gi"));
  return parts.map((part, i) => {
    if (part.toLowerCase() === q) {
      return (
        <span key={i} style={{ background: `${themeColors.accent}30`, borderRadius: 2, padding: "0 2px" }}>
          {part}
        </span>
      );
    }
    const mentionParts = part.split(/(@[a-zA-Z0-9_]+)/g);
    return mentionParts.map((mp, j) => {
      if (/^@[a-zA-Z0-9_]+$/.test(mp)) {
        return (
          <span key={`${i}-${j}`} style={{ color: themeColors.accent, fontWeight: 700, background: `${themeColors.accent}12`, borderRadius: 4, padding: "0 3px" }}>
            {mp}
          </span>
        );
      }
      return mp;
    });
  });
}

function MessageBubble({
  msg,
  isOwn,
  themeColors,
  onReact,
  searchQuery,
  myUid,
}: {
  msg: ChatMessage;
  isOwn: boolean;
  themeColors: any;
  onReact?: (emoji: string, msgId: string) => void;
  searchQuery?: string;
  myUid: string;
}) {

  if (msg.type === "system") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="py-1 px-2"
      >
        <p
          className="text-[10px] text-center tinycaps"
          style={{ color: themeColors.text_muted }}
        >
          {msg.text}
        </p>
      </motion.div>
    );
  }

  if (msg.type === "invite" && msg.inviteData) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="py-2 px-1"
      >
        <div
          className="rounded-xl p-3 max-w-md mx-auto"
          style={{
            background: `linear-gradient(135deg, ${themeColors.blue}15, ${themeColors.purple || themeColors.blue}10)`,
            border: `1px solid ${themeColors.blue}30`,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Swords size={14} style={{ color: themeColors.blue }} />
            <span
              className="tinycaps text-[11px] font-bold"
              style={{ color: themeColors.blue }}
            >
              Server Invite
            </span>
          </div>
          <p
            className="text-[11px] mb-2"
            style={{ color: themeColors.text_main }}
          >
            {msg.text}
          </p>
          <div
            className="flex items-center gap-3 text-[10px] mb-2"
            style={{ color: themeColors.text_sub }}
          >
            <span>
              {msg.inviteData.serverAddress}:{msg.inviteData.serverPort}
            </span>
            <span>•</span>
            <span>MC {msg.inviteData.mcVersion}</span>
          </div>
          <div className="flex gap-2">
            <GlowButton
              size="sm"
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(
                  `${msg.inviteData!.serverAddress}:${msg.inviteData!.serverPort}`
                );
              }}
            >
              Copy Address
            </GlowButton>
          </div>
        </div>
      </motion.div>
    );
  }

  const readCount = (msg.readBy || []).length;
  const isRead = msg.readBy && msg.readBy.includes(myUid);
  const reactions = msg.reactions || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-2.5 py-1.5 px-2 rounded-lg transition-colors group ${isOwn ? "flex-row-reverse" : ""}`}
      style={{
        background: isOwn ? `${themeColors.accent}08` : "transparent",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = isOwn
          ? `${themeColors.accent}12`
          : `${themeColors.bg_hover}40`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = isOwn
          ? `${themeColors.accent}08`
          : "transparent";
      }}
    >
      <img
        src={msg.photoURL || STEVE_HEAD}
        alt=""
        className="w-7 h-7 rounded-lg object-cover shrink-0 mt-0.5"
        style={{ border: `1.5px solid ${themeColors.border}` }}
        onError={(e) => {
          (e.target as HTMLImageElement).src = STEVE_HEAD;
        }}
      />
      <div className={`min-w-0 flex-1 ${isOwn ? "text-right" : ""}`}>
        <div
          className={`flex items-center gap-2 mb-0.5 ${isOwn ? "justify-end" : ""}`}
        >
          <span
            className="tinycaps text-[10px] font-bold"
            style={{
              color: isOwn ? themeColors.accent : themeColors.text_sub,
            }}
          >
            {msg.username}
          </span>
          {msg.type === "dm" && (
            <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: `${themeColors.blue}20`, color: themeColors.blue }}>
              DM
            </span>
          )}
          <span
            className="text-[9px] flex items-center gap-0.5"
            style={{ color: themeColors.text_muted }}
          >
            <Clock size={8} />
            {formatTime(msg.timestamp)}
          </span>
          {isOwn && (
            <span className="text-[9px]" style={{ color: themeColors.text_muted }}>
              {isRead ? <CheckCheck size={10} style={{ color: themeColors.success }} /> : <Clock size={10} style={{ color: themeColors.text_muted }} />}
              {readCount > 1 && <span className="ml-0.5">({readCount})</span>}
            </span>
          )}
        </div>
        <p
          className="text-[12px] leading-relaxed break-words"
          style={{ color: themeColors.text_main }}
        >
          {renderMessageText(msg.text, themeColors, searchQuery)}
        </p>
        {reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {reactions.map((r, i) => {
              const hasReacted = r.uids.includes(myUid);
              return (
                <button
                  key={i}
                  onClick={() => onReact?.(r.emoji, msg.id)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg transition-colors cursor-pointer"
                  style={{
                    background: hasReacted ? `${themeColors.accent}20` : `${themeColors.bg_card2}`,
                    border: `1px solid ${hasReacted ? themeColors.accent : themeColors.border}30`,
                  }}
                >
                  <span className="text-[12px]">{r.emoji}</span>
                  <span className="text-[9px] tinycaps" style={{ color: hasReacted ? themeColors.accent : themeColors.text_muted }}>
                    {r.uids.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {/* Reaction picker on hover */}
        <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {["👍", "❤️", "😂", "🔥", "🎉", "👀"].map((emoji) => (
            <button
              key={emoji}
              onClick={() => onReact?.(emoji, msg.id)}
              className="text-[14px] px-1 py-0.5 rounded transition-colors cursor-pointer"
              style={{ background: "transparent" }}
              onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.background = `${themeColors.bg_hover}`; }}
              onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = "transparent"; }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
