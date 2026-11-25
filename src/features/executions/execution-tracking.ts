type ExecutionTrackingListener = (executionId: string) => void

const listeners = new Set<ExecutionTrackingListener>()
const pendingExecutionIds = new Set<string>()

export function shouldNotifyExecution(conversationId: string, pathname: string) {
  return pathname !== `/conversations/${encodeURIComponent(conversationId)}`
}

export function trackExecutionCompletion(executionId: string) {
  if (listeners.size === 0) {
    pendingExecutionIds.add(executionId)
    return
  }
  listeners.forEach((listener) => listener(executionId))
}

export function subscribeToExecutionTracking(listener: ExecutionTrackingListener) {
  listeners.add(listener)
  pendingExecutionIds.forEach(listener)
  pendingExecutionIds.clear()
  return () => listeners.delete(listener)
}
