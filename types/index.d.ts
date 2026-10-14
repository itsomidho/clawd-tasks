// One tool call, filed under the task that was in progress when it ran.
export type Step = {
  id: string
  tool: string
  label: string
  startedAt: number
  endedAt?: number
  isError?: boolean
  // Set when a subagent made the call.
  agentId?: string
}

export type FileChange = { path: string; added: number; removed: number }

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = {
  id: string
  subject: string
  activeForm: string
  status: TaskStatus
  startedAt?: number
  endedAt?: number
  steps: Step[]
  // How many steps were dropped from the front of `steps` to keep it short.
  dropped: number
  files: FileChange[]
  agents: number
}

export type Board = {
  tasks: Task[]
  // Calls made while no task was in progress.
  loose: number
  startedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'clawd-tasks': { board: Board; now: number; isHidden: boolean }
  }
}
