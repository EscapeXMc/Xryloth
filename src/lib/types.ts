/* Based on original types.ts - cleaned up to fix compile errors */
/* Extended for v7.0 - FastClient-beating architecture */

export interface Settings {
  mc_token?: string;
  ms_refresh_token?: string;
  username?: string;
  cracked_username?: string;
  ely_by_username?: string;
  ely_access_token?: string;
  ely_uuid?: string;
  ely_refresh_token?: string;
  ely_token?: string;
  ely_skin_url?: string;
  theme?: string;
  ram_mb?: number;
  java_path?: string;
  global_jvm?: string;
  dl_connections?: number;
  performance_mode?: boolean;
  enable_bg_animation?: boolean;
  enable_particles?: boolean;
  discord_rpc?: boolean;
  auto_update?: boolean;
  perf_game_config?: boolean;
  perf_jvm_aggressive?: boolean;
  perf_auto_mods?: boolean;
  perf_ram_opt?: boolean;
  def_vsync_off?: boolean;
  def_no_music?: boolean;
  def_gamma?: boolean;
  def_full_bright?: boolean;
  custom_skin_path?: string;
  pre_launch_cmd?: string;
  post_launch_cmd?: string;
  close_on_start?: boolean;
  keep_open?: boolean;
  show_dev_builds?: boolean;
  jvm_args?: string;
  min_memory?: number;
  max_memory?: number;
  concurrent_downloads?: number;
  download_speed_limit?: number;
  skip_existing?: boolean;
  use_authlib?: boolean;
  show_elyby?: boolean;
  game_directory?: string;
  java_directory?: string;
  mods_directory?: string;
  auto_check_updates?: boolean;
  launcher_bg_type?: "default" | "image" | "video" | "none";
  launcher_bg_image?: string;
  launcher_bg_video?: string;
  launcher_bg_opacity?: number;
  launcher_bg_blur?: number;
  launcher_bg_brightness?: number;
  launcher_bg_dimming?: number;
  launcher_bg_fit?: "cover" | "contain" | "fill" | "stretch";
  sidebar_style?: "default" | "compact" | "wide" | "icons-only";
  sidebar_opacity?: number;
  sidebar_blur?: number;
  accent_color?: string;
  title_bar_style?: "default" | "transparent" | "hidden";
  show_news_home?: boolean;
  default_page?: string;
  compact_mode?: boolean;
  animations_enabled?: boolean;
  launch_close_delay?: number;
  game_resolution_width?: number;
  game_resolution_height?: number;
  game_fullscreen?: boolean;
  force_update?: boolean;
  language?: string;
  show_playtime?: boolean;
  show_system_stats?: boolean;
  [key: string]: any;
}

/* ------------------------------------------------------------------ Instance */
export interface Instance {
  id: string;
  name: string;
  version: string;
  loader: string;
  loader_version: string;
  created: string;
  last_played: string | null;
  icon: string;
  installed?: boolean;
  version_json_exists?: boolean;
  mods?: Array<{
    name: string;
    slug?: string;
    version?: string;
    enabled?: boolean;
    source?: "modrinth" | "curseforge" | "local";
    filename?: string;
  }>;
  ram_mb?: number;
  jvm_args?: string;
  is_favorite?: boolean;
}

/* ------------------------------------------------------------------ Mods */
export interface ModInfo {
  slug: string;
  name: string;
  version: string;
  filename: string;
  enabled: boolean;
  source: "modrinth" | "curseforge" | "local" | "resourcepack";
  download_url?: string;
  icon_url?: string;
  banner_url?: string;
  summary?: string;
  author?: string;
  loaders?: string[];
  game_versions?: string[];
  dependencies?: ModDependency[];
  downloads?: number;
  category?: "mod" | "modpack" | "resourcepack";
}

export interface ModDependency {
  slug: string;
  name: string;
  installed: boolean;
  filename?: string;
  required: boolean;
}

export interface ModConflict {
  mod1: string;
  mod2: string;
  reason: string;
  severity: "low" | "medium" | "high" | "critical";
}

export interface ModUpdate {
  slug: string;
  filename: string;
  current_version: string;
  latest_version: string;
  download_url: string;
  mod_name: string;
}

export interface ModSearchResult {
  slug: string;
  title: string;
  description: string;
  downloads: number;
  icon_url?: string;
  categories?: string[];
  versions?: string[];
  project_type?: string;
  author?: string;
  latest_version?: string;
  loaders?: string[];
  game_versions?: string[];
}

export interface ModrinthHit {
  id: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  downloads_url?: string;
  icon_url?: string;
  banner_url?: string;
  gallery?: Array<{ url: string; title?: string }>;
  featured_gallery?: string;
  categories?: string[];
  versions?: string[];
  project_type?: string;
  author?: string;
  latest_version?: string;
  loaders?: string[];
  game_versions?: string[];
  dependencies?: ModDependency[];
}

export interface LoaderVersion {
  version: string;
  build: number;
  loader: string;
  game_version: string;
  direct_download_url?: string;
}

/* ------------------------------------------------------------------ Server */
export interface ServerStatus {
  online: boolean;
  host: string;
  port: string;
  version: string;
  players_online: number;
  players_max: number;
  motd: string;
  icon: string;
  latency: number;
  tps?: number;
  error?: string;
}

export interface ServerEntry {
  name: string;
  address: string;
  port: number;
}

/* ------------------------------------------------------------------ System */
export interface SystemInfo {
  cpu: number;
  ram_used: number;
  ram_total: number;
  ram_pct: number;
  disk_used: number;
  disk_total: number;
  disk_pct: number;
}

/* ------------------------------------------------------------------ Theme */
export interface ThemeColors {
  bg_main: string;
  bg_nav: string;
  bg_card: string;
  bg_card2: string;
  bg_glass: string;
  bg_hover: string;
  accent: string;
  accent2: string;
  accent_hover: string;
  accent_dim: string;
  accent_glow: string;
  accent_text: string;
  text_main: string;
  text_sub: string;
  text_muted: string;
  border: string;
  border_bright: string;
  border_accent: string;
  danger: string;
  warn: string;
  success: string;
  blue: string;
  purple: string;
  green: string;
  tag_fabric: string;
  tag_forge: string;
  tag_vanilla: string;
  tag_quilt: string;
  tag_neo: string;
  nav_active: string;
  nav_inactive: string;
  server1: string;
  server2: string;
  server3: string;
  server4: string;
  server5: string;
  glass_reflect: string;
  particle_color: string;
}

export const THEMES: Record<string, { name: string; display_name: string; accent: string; colors: ThemeColors }> = {
  orange: {
    name: "orange",
    display_name: "Xryloth",
    accent: "#e06b22",
    colors: {
      // FastClient pure dark palette
      bg_main: "#090B0E", bg_nav: "#0A0C0E", bg_card: "#13161C", bg_card2: "#161922",
      bg_glass: "#161922", bg_hover: "#1C2029", accent: "#e06b22", accent2: "#c85108",
      accent_hover: "#f07c32", accent_dim: "#2a1a10", accent_glow: "#e06b22",
      accent_text: "#ffffff",
      text_main: "#ffffff", text_sub: "#a1a1aa", text_muted: "#71717a",
      border: "#1f2430", border_bright: "#2a303c", border_accent: "#e06b22",
      danger: "#ef4444", warn: "#f59e0b", success: "#22c55e", blue: "#37c9ff", purple: "#bd5cff", green: "#22c55e",
      tag_fabric: "#37c9ff", tag_forge: "#f59e0b", tag_vanilla: "#e06b22",
      tag_quilt: "#bd5cff", tag_neo: "#f48c06", nav_active: "#e06b22", nav_inactive: "#71717a",
      server1: "#13161C", server2: "#161922", server3: "#063326", server4: "#2b103f", server5: "#350824",
      glass_reflect: "#2a303c", particle_color: "#e06b22",
    },
  },
  ember: {
    name: "ember",
    display_name: "Ember Mark",
    accent: "#ff5500",
    colors: {
      bg_main: "#0a0200", bg_nav: "#140802", bg_card: "#1e0f06", bg_card2: "#28170a",
      bg_glass: "#331d0e", bg_hover: "#462412", accent: "#ff5500", accent2: "#ff6600",
      accent_hover: "#ff7a33", accent_dim: "#4d1a00", accent_glow: "#ff6600",
      accent_text: "#1a0500",
      text_main: "#fff3e0", text_sub: "#ffcda8", text_muted: "#cf9370",
      border: "#4d2610", border_bright: "#7c3f1c", border_accent: "#ff5500",
      danger: "#ff4466", warn: "#ffb020", success: "#29f59a", blue: "#37c9ff", purple: "#bd5cff", green: "#29f59a",
      tag_fabric: "#37c9ff", tag_forge: "#ffb020", tag_vanilla: "#ff5500",
      tag_quilt: "#bd5cff", tag_neo: "#ff8c06", nav_active: "#ff5500", nav_inactive: "#cf9370",
      server1: "#4d1c06", server2: "#4a2605", server3: "#063326", server4: "#2b103f", server5: "#350824",
      glass_reflect: "#ff8a4d", particle_color: "#ff5500",
    },
  },
  black: {
    name: "black",
    display_name: "Black (Default)",
    accent: "#f4f4f5",
    colors: {
      bg_main: "#000000", bg_nav: "#050505", bg_card: "#0b0b0d", bg_card2: "#111114",
      bg_glass: "#161619", bg_hover: "#1e1e22", accent: "#f4f4f5", accent2: "#a1a1aa",
      accent_hover: "#ffffff", accent_dim: "#1b1b1f", accent_glow: "#ffffff",
      accent_text: "#09090b",
      text_main: "#f4f4f5", text_sub: "#a1a1aa", text_muted: "#71717a",
      border: "#1a1a1a", border_bright: "#2e2e2e", border_accent: "#f4f4f5",
      danger: "#ef4444", warn: "#f59e0b", success: "#22c55e", blue: "#60a5fa", purple: "#a1a1aa", green: "#22c55e",
      tag_fabric: "#60a5fa", tag_forge: "#f59e0b", tag_vanilla: "#a1a1aa",
      tag_quilt: "#a1a1aa", tag_neo: "#f59e0b", nav_active: "#f4f4f5", nav_inactive: "#808080",
      server1: "#111114", server2: "#141418", server3: "#17171b", server4: "#121216", server5: "#18181c",
      glass_reflect: "#ffffff", particle_color: "#ffffff",
    },
  },
  fastclient: {
    name: "fastclient",
    display_name: "Fast Client",
    accent: "#ff0022",
    colors: {
      bg_main: "#050308", bg_nav: "#0a0610", bg_card: "#120a18", bg_card2: "#1a0f22",
      bg_glass: "#22142e", bg_hover: "#2c1a3a", accent: "#ff0022", accent2: "#aa0000",
      accent_hover: "#ff5566", accent_dim: "#3a0a12", accent_glow: "#ff0022",
      accent_text: "#ffffff",
      text_main: "#f1f5f9", text_sub: "#94a3b8", text_muted: "#475569",
      border: "#1e1e2e", border_bright: "#2a2a3e", border_accent: "#ff0022",
      danger: "#ef4444", warn: "#f97316", success: "#22c55e", blue: "#3b82f6", purple: "#a855f7", green: "#f97316",
      tag_fabric: "#3b82f6", tag_forge: "#f97316", tag_vanilla: "#ff0022",
      tag_quilt: "#a855f7", tag_neo: "#f97316", nav_active: "#ff0022", nav_inactive: "#475569",
      server1: "#3a0a12", server2: "#1e3a5f", server3: "#14532d", server4: "#3b0764", server5: "#4a1942",
      glass_reflect: "#ff5577", particle_color: "#ff5566",
    },
  },
  lunar: {
    name: "lunar",
    display_name: "Lunar",
    accent: "#00e6a0",
    colors: {
      bg_main: "#040408", bg_nav: "#070810", bg_card: "#0c0e18", bg_card2: "#111420",
      bg_glass: "#161a2a", bg_hover: "#1c2136", accent: "#00e6a0", accent2: "#00b87a",
      accent_hover: "#33ffb8", accent_dim: "#003a28", accent_glow: "#00e6a0",
      accent_text: "#ffffff",
      text_main: "#e8fef5", text_sub: "#7ad4b0", text_muted: "#2a6a52",
      border: "#1a2e26", border_bright: "#244a3a", border_accent: "#00e6a0",
      danger: "#ff4466", warn: "#ffaa00", success: "#00e676", blue: "#00c8ff", purple: "#a855f7", green: "#ffaa00",
      tag_fabric: "#00c8ff", tag_forge: "#ffaa00", tag_vanilla: "#00e6a0",
      tag_quilt: "#a855f7", tag_neo: "#ffaa00", nav_active: "#00e6a0", nav_inactive: "#2a6a52",
      server1: "#003a28", server2: "#002a3a", server3: "#003a1a", server4: "#1a003a", server5: "#2a003a",
      glass_reflect: "#66f0c4", particle_color: "#33ffb8",
    },
  },
};

export interface ModProfile {
  name: string;
  created: string;
  instance_source: string;
  mods: Array<{ slug: string; version_id: string; filename: string }>;
}

export interface CrashLogInfo {
  has_crash: boolean;
  content: string;
  source: string;
  timestamp: string;
}

export interface MrpackExportResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface UpdateInfo {
  update_available: boolean;
  current_version?: string;
  current_arch?: string;
  latest_version?: string;
  tag?: string;
  download_url?: string;
  download_name?: string;
  download_size?: number;
  release_notes?: string;
  published_at?: string;
  error?: string;
}

export interface NewsItem {
  title: string;
  url: string;
  date: string;
  type: string;
  image?: string;
}

export {};

// Make top-level bindings exportable
export type { };