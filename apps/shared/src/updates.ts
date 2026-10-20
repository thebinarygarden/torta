export type UpdateStatus = {
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error';
  /** The new version, once one is found. */
  version?: string;
  /** Download progress, 0–100. */
  percent?: number;
};

/** `available` is false outside the installed app, where nothing updates. */
export type UpdatesInfo =
  | { available: false }
  | ({
      available: true;
      /** When the data was last copied aside before an update. */
      backupAt: string | null;
    } & UpdateStatus);
