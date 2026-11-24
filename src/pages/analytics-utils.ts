export interface ExecutionActivityPoint {
  date: string
  count: number
}

export function scaleExecutionActivity(
  activity: ExecutionActivityPoint[],
  width: number,
  height: number,
) {
  const maxCount = Math.max(0, ...activity.map(({ count }) => count))
  const lastIndex = Math.max(1, activity.length - 1)

  return activity.map((point, index) => ({
    ...point,
    x: activity.length === 1 ? width / 2 : (index / lastIndex) * width,
    y: maxCount === 0 ? height : height - (point.count / maxCount) * height,
  }))
}
