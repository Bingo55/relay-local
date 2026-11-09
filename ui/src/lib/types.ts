export type Mode = 'plan' | 'code' | 'orchestrate'
export type StepStatus = 'running' | 'done' | 'stopped' | 'failed' | 'timeout' | 'quota'
export interface PlanStep { agent?: string; agents?: string[]; prompt: string; why?: string; model?: string; kind?: string; question?: string }
interface MessageBase { id: string; at?: string }
export interface UserMessage extends MessageBase { role: 'user'; text: string }
export interface NoteMessage extends MessageBase { role: 'note'; text: string }
export interface PlanMessage extends MessageBase {
  role: 'plan'; task: string; note: string; steps: PlanStep[]; mode?: Mode; model?: string; via?: string;
}
export interface StepMessage extends MessageBase {
  role: 'step'; stepId?: string; n: number; agent: string; label: string; model?: string;
  why?: string; kind?: string; question?: string; prompt: string; text: string; thinking?: string;
  status: StepStatus; startedAt: string; endedAt?: string; durationMs?: number; exitCode?: number;
  originalAgent?: string; fallback?: { from: string; to: string; reason: string }[];
  git?: { before: GitSnapshot | null; after: GitSnapshot | null };
}
export interface GitSnapshot { files: string[]; diffstat?: string }
export type Message = UserMessage | NoteMessage | PlanMessage | StepMessage
export interface Pin { stepId: string; agent: string; text: string; at: string }
export interface SideNote { id: string; text: string; at: string }
export interface Session {
  id: string; title: string; cwd: string; instructor?: string; messages: Message[];
  pinned?: Pin[]; notes?: SideNote[]; createdAt?: string; updatedAt?: string;
}
export interface SessionSummary { id: string; title: string; cwd: string; updatedAt: string; createdAt?: string }
export interface Agent {
  id: string; label: string; model?: string; models?: string[]; disabled?: boolean;
  caps?: string; note?: string; connectionId?: string; defaultFor?: string[];
}
export interface Instructor { id: string; label: string }
export interface QuotaAgent {
  id: string; label: string; disabled: boolean; limit: number; window: string; used: number;
  calls: number; errors: number; quotaHits: number; percent: number | null; level: string;
  out: boolean; cooling: boolean; outUntil: string | null; outReason: string; lastAt?: string | null;
}
export interface Quota { mode: string; note?: string; agents: QuotaAgent[]; route: QuotaAgent | null }
export type Protocol = 'openai' | 'anthropic'
export interface Connection {
  id: string; providerId: string; name: string; protocol: Protocol; baseUrl: string;
  models: string[]; defaultModel: string; hasKey: boolean; keyHint: string; agentId: string;
}
export interface ConnectionInput {
  id?: string; providerId?: string; name: string; protocol: Protocol; baseUrl: string;
  models: string[]; defaultModel?: string; apiKey?: string;
}
export interface Provider {
  id: string; name: string; protocol: Protocol; baseUrl: string; models: string[];
  note?: string; keyUrl?: string; docs?: string; tags?: string[]; popular?: boolean;
}
export interface McpServer {
  id: string; name: string; command: string; args: string[]; envKeys?: string[];
  cwd?: string; agents: string[]; enabled: boolean; note?: string;
}
export interface Plugin { id: string; name: string; instructions: string; agents: string[]; enabled: boolean }
export interface Registry { mcp: McpServer[]; plugins: Plugin[]; file?: string }
export interface Preset { note: string; steps: PlanStep[] }
export type Presets = Record<string, Preset>
export interface Health { at: string | null; results: { id?: string; agent?: string; label?: string; ok?: boolean; error?: string; note?: string; status?: string; durationMs?: number }[] }
export interface Bootstrap {
  session: Session; sessions: SessionSummary[]; agents: Agent[]; roles: Record<string, string[]>;
  instructors: Instructor[]; busy: boolean; btwRuns: number; runningSessionIds: string[];
  root: string; quota: Quota; connections: Connection[]; registry: Registry;
}
export type RelayEvent =
  | { type: 'hello'; session: Session; busy: boolean; btwRuns: number; runningSessionIds: string[] }
  | { type: 'message' | 'message.update'; message: Message; sessionId?: string }
  | { type: 'delta'; id: string; text: string; sessionId?: string }
  | { type: 'agent'; agent: string; state: 'running' | 'cooling' | 'idle'; sessionId?: string }
  | { type: 'quota'; quota: Quota; sessionId?: string }
  | { type: 'busy'; busy: boolean; btwRuns: number; runningSessionIds: string[] }
  | { type: 'notice'; text: string; sessionId?: string }
