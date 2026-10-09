import {
  auth, db,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile,
  ref, set, get, push, onValue, onChildAdded, onChildChanged, serverTimestamp,
  query, orderByChild, limitToLast, update, remove,
} from "./firebase";
import type { User } from "./firebase";

export interface ChatUser {
  uid: string;
  username: string;
  email: string;
  displayName: string;
  photoURL: string;
  status: "online" | "offline";
  lastSeen: number;
  createdAt: number;
  mcUsername?: string;
}

export interface ChatReaction {
  emoji: string;
  uids: string[];
}

export interface ChatMessage {
  id: string;
  uid: string;
  username: string;
  photoURL: string;
  text: string;
  timestamp: number;
  type: "message" | "system" | "invite" | "dm";
  mentions?: string[];
  inviteData?: {
    serverAddress: string;
    serverPort: number;
    mcVersion: string;
  };
  readBy?: string[];
  reactions?: ChatReaction[];
  targetUid?: string;
  channel?: string;
}

export interface ChatChannel {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: number;
  isDM: boolean;
  participants: string[];
  lastMessage?: string;
  lastMessageTime?: number;
}

// Auth functions
export async function registerUser(email: string, password: string, username: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if username is taken
    const usernameRef = ref(db, `usernames/${username}`);
    const usernameSnap = await get(usernameRef);
    if (usernameSnap.exists()) {
      return { success: false, error: "Username already taken" };
    }

    // Create auth account
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const user = cred.user;

    // Update display name
    await updateProfile(user, { displayName: username });

    // Create user profile in database
    const userProfile: ChatUser = {
      uid: user.uid,
      username,
      email,
      displayName: username,
      photoURL: "", // Will be Steve head URL
      status: "online",
      lastSeen: Date.now(),
      createdAt: Date.now(),
    };

    await set(ref(db, `users/${user.uid}`), userProfile);
    await set(ref(db, `usernames/${username}`), user.uid);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function loginUser(email: string, password: string): Promise<{ success: boolean; error?: string }> {
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // Set online
    if (auth.currentUser) {
      await update(ref(db, `users/${auth.currentUser.uid}`), {
        status: "online",
        lastSeen: Date.now(),
      });
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function logoutUser(): Promise<void> {
  if (auth.currentUser) {
    await update(ref(db, `users/${auth.currentUser.uid}`), {
      status: "offline",
      lastSeen: Date.now(),
    });
    await signOut(auth);
  }
}

export async function uploadProfileImage(file: File): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const user = auth.currentUser;
    if (!user) return { success: false, error: "Not logged in" };

    // Convert to base64 and store in database (no Storage needed)
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    // Resize to keep database small
    const img = new Image();
    const dataUrlResolved = await new Promise<string>((resolve) => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 128;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = dataUrl;
    });

    // Update profile
    await updateProfile(user, { photoURL: dataUrlResolved });
    await update(ref(db, `users/${user.uid}`), { photoURL: dataUrlResolved });

    return { success: true, url: dataUrlResolved };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Chat functions
export async function sendMessage(text: string, type: "message" | "system" | "invite" | "dm" = "message", inviteData?: any, mentions?: string[], targetUid?: string, channel?: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not logged in");

  const msgRef = ref(db, "messages");
  const newMsg = push(msgRef);

  const message: ChatMessage = {
    id: newMsg.key || "",
    uid: user.uid,
    username: user.displayName || "Unknown",
    photoURL: user.photoURL || "",
    text,
    timestamp: Date.now(),
    type,
    ...(mentions && mentions.length ? { mentions } : {}),
    ...(inviteData ? { inviteData } : {}),
    ...(targetUid ? { targetUid } : {}),
    ...(channel ? { channel } : {}),
  };

  await set(newMsg, message);
}

export function extractMentions(text: string): string[] {
  const matches = text.match(/@([a-zA-Z0-9_]+)/g) || [];
  return [...new Set(matches.map((m) => m.slice(1)))];
}

export function subscribeToMessages(callback: (messages: ChatMessage[]) => void): () => void {
  const messagesRef = query(ref(db, "messages"), orderByChild("timestamp"), limitToLast(100));

  const unsubscribe = onValue(messagesRef, (snapshot: any) => {
    const messages: ChatMessage[] = [];
    snapshot.forEach((child: any) => {
      const data = child.val();
      if (data) messages.push({ ...data, id: child.key || "" });
    });
    callback(messages.sort((a, b) => a.timestamp - b.timestamp));
  }, (error: any) => {
    console.error("Chat subscription error:", error);
  });

  return unsubscribe;
}

export function subscribeToMessagesByChannel(callback: (messages: ChatMessage[]) => void, channel: string): () => void {
  const messagesRef = query(ref(db, "messages"), orderByChild("timestamp"), limitToLast(100));

  const unsubscribe = onValue(messagesRef, (snapshot: any) => {
    const messages: ChatMessage[] = [];
    snapshot.forEach((child: any) => {
      const data = child.val();
      if (data && data.channel === channel) messages.push({ ...data, id: child.key || "" });
    });
    callback(messages.sort((a, b) => a.timestamp - b.timestamp));
  }, (error: any) => {
    console.error("Chat subscription error:", error);
  });

  return unsubscribe;
}

export function subscribeToDMs(callback: (messages: ChatMessage[]) => void, targetUid: string): () => void {
  const messagesRef = query(ref(db, "messages"), orderByChild("timestamp"), limitToLast(100));

  const unsubscribe = onValue(messagesRef, (snapshot: any) => {
    const messages: ChatMessage[] = [];
    snapshot.forEach((child: any) => {
      const data = child.val();
      if (data && data.type === "dm" && (data.targetUid === targetUid || data.uid === targetUid)) {
        messages.push({ ...data, id: child.key || "" });
      }
    });
    callback(messages.sort((a, b) => a.timestamp - b.timestamp));
  }, (error: any) => {
    console.error("Chat subscription error:", error);
  });

  return unsubscribe;
}

export async function markMessagesAsRead(messageIds: string[]): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const uid = user.uid;
  for (const id of messageIds) {
    const msgRef = ref(db, `messages/${id}`);
    const snap = await get(msgRef);
    if (snap.exists()) {
      const data = snap.val();
      const readBy: string[] = data.readBy || [];
      if (!readBy.includes(uid)) {
        readBy.push(uid);
        await update(msgRef, { readBy });
      }
    }
  }
}

export async function addReaction(messageId: string, emoji: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not logged in");
  const uid = user.uid;

  const msgRef = ref(db, `messages/${messageId}`);
  const snap = await get(msgRef);
  if (!snap.exists()) return;

  const data = snap.val();
  const reactions: ChatReaction[] = data.reactions || [];
  const existing = reactions.find((r) => r.emoji === emoji);
  if (existing) {
    if (existing.uids.includes(uid)) {
      existing.uids = existing.uids.filter((u) => u !== uid);
      if (existing.uids.length === 0) {
        const idx = reactions.indexOf(existing);
        reactions.splice(idx, 1);
      }
    } else {
      existing.uids.push(uid);
    }
  } else {
    reactions.push({ emoji, uids: [uid] });
  }

  await update(msgRef, { reactions });
}

export async function createChannel(name: string, description: string): Promise<{ success: boolean; error?: string; channelId?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: "Not logged in" };
  try {
    const channelRef = push(ref(db, "channels"));
    const channel: ChatChannel = {
      id: channelRef.key || "",
      name,
      description,
      createdBy: user.uid,
      createdAt: Date.now(),
      isDM: false,
      participants: [user.uid],
    };
    await set(channelRef, channel);
    return { success: true, channelId: channelRef.key || "" };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function joinChannel(channelId: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: "Not logged in" };
  try {
    const channelRef = ref(db, `channels/${channelId}`);
    const snap = await get(channelRef);
    if (!snap.exists()) return { success: false, error: "Channel not found" };
    const channel = snap.val();
    const participants: string[] = channel.participants || [];
    if (!participants.includes(user.uid)) {
      participants.push(user.uid);
      await update(channelRef, { participants });
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function subscribeToChannels(callback: (channels: ChatChannel[]) => void): () => void {
  const channelsRef = ref(db, "channels");
  const unsubscribe = onValue(channelsRef, (snapshot: any) => {
    const channels: ChatChannel[] = [];
    snapshot.forEach((child: any) => {
      const data = child.val();
      if (data) channels.push({ ...data, id: child.key || "" });
    });
    callback(channels.sort((a, b) => b.createdAt - a.createdAt));
  });
  return unsubscribe;
}

export async function sendDM(targetUsername: string, text: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: "Not logged in" };
  const targetUser = await getUserByUsername(targetUsername);
  if (!targetUser) return { success: false, error: "User not found" };
  await sendMessage(text, "dm", undefined, undefined, targetUser.uid);
  return { success: true };
}

export function searchMessages(query: string, messages: ChatMessage[]): ChatMessage[] {
  const q = query.toLowerCase();
  return messages.filter((m) => m.text.toLowerCase().includes(q));
}

export function subscribeToOnlineUsers(callback: (users: ChatUser[]) => void): () => void {
  const usersRef = ref(db, "users");

  const unsubscribe = onValue(usersRef, (snapshot: any) => {
    const users: ChatUser[] = [];
    snapshot.forEach((child: any) => {
      const data = child.val();
      if (data) users.push(data);
    });
    callback(users.sort((a, b) => (b.status === "online" ? 1 : 0) - (a.status === "online" ? 1 : 0)));
  });

  return unsubscribe;
}

export async function getUserByUsername(username: string): Promise<ChatUser | null> {
  try {
    const usernameRef = ref(db, `usernames/${username}`);
    const usernameSnap = await get(usernameRef);
    if (!usernameSnap.exists()) return null;

    const uid = usernameSnap.val();
    const userRef = ref(db, `users/${uid}`);
    const userSnap = await get(userRef);
    if (!userSnap.exists()) return null;

    return userSnap.val();
  } catch {
    return null;
  }
}

export async function sendInvite(targetUsername: string, serverAddress: string, serverPort: number, mcVersion: string): Promise<{ success: boolean; error?: string }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: "Not logged in" };

  const targetUser = await getUserByUsername(targetUsername);
  if (!targetUser) return { success: false, error: "User not found" };

  await sendMessage(`🎮 ${user.displayName} invited you to join ${serverAddress}:${serverPort}`, "invite", {
    serverAddress,
    serverPort,
    mcVersion,
    fromUser: user.displayName,
    fromUid: user.uid,
    toUser: targetUsername,
    toUid: targetUser.uid,
  });

  return { success: true };
}

// Set user online status
export function setupPresence() {
  const user = auth.currentUser;
  if (!user) return;

  const userRef = ref(db, `users/${user.uid}`);
  update(userRef, { status: "online", lastSeen: Date.now() });
}
