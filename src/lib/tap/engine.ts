export interface BuildSendResult {
  ok: boolean;
  summary: string;
}

export interface BuildSession {
  send(prompt: string): Promise<BuildSendResult>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export interface BuildEngineOptions {
  cwd: string;
  onLog: (line: string) => void;
}

export interface BuildEngine {
  createSession(opts: BuildEngineOptions): Promise<BuildSession>;
}
