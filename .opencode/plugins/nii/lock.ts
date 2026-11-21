/** Per-key async mutex. Prevents concurrent callers from duplicating work. */

const chains = new Map<string, Promise<void>>()

export async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = previous.then(() => gate)
  chains.set(key, chained)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (chains.get(key) === chained) chains.delete(key)
  }
}
