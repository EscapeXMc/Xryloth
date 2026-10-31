import { create } from "zustand";
import { api } from "../lib/api";

export interface ServerStatus {
  name: string;
  address: string;
  port: number;
  online: boolean;
  players_online: number;
  players_max: number;
  version: string;
  motd: string;
  icon: string;
  latency: number;
  tps?: number;
}

export interface ServerEntry {
  name: string;
  address: string;
  port: number;
}

export interface ServerStore {
  servers: ServerStatus[];
  isLoading: boolean;
  setServers: (servers: ServerStatus[]) => void;
  setLoading: (loading: boolean) => void;
  addServer: (server: ServerEntry) => Promise<void>;
  removeServer: (address: string) => Promise<void>;
  refreshServers: () => Promise<void>;
}

export const useServerStore = create<ServerStore>((set, get) => ({
  servers: [],
  isLoading: false,

  setServers: (servers) => set({ servers }),
  setLoading: (loading) => set({ isLoading: loading }),

  addServer: async (server) => {
    try {
      await api.servers.add(server.name, server.address, server.port);
      await get().refreshServers();
    } catch (err) {
      console.error("Failed to add server:", err);
    }
  },

  removeServer: async (address) => {
    try {
      await api.servers.delete(address);
      await get().refreshServers();
    } catch (err) {
      console.error("Failed to remove server:", err);
    }
  },

  refreshServers: async () => {
    set({ isLoading: true });
    try {
      const servers = await api.servers.get();
      const results = await Promise.all(
        servers.map(async (s) => {
          try {
            const status = await api.servers.ping(s.address, s.port);
            return {
              name: s.name,
              address: s.address,
              port: s.port,
              online: status.online,
              players_online: status.players?.online ?? 0,
              players_max: status.players?.max ?? 0,
              version: status.version || "Unknown",
              motd: status.motd || "No MOTD",
              icon: "",
              latency: 0,
            };
          } catch {
            return {
              name: s.name,
              address: s.address,
              port: s.port,
              online: false,
              players_online: 0,
              players_max: 0,
              version: "Unknown",
              motd: "Offline",
              icon: "",
              latency: 0,
            };
          }
        })
      );
      set({ servers: results });
    } catch (err) {
      console.error("Failed to refresh servers:", err);
    } finally {
      set({ isLoading: false });
    }
  },
}));