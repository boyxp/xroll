import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

// 应用数据目录：~/Library/Application Support/<App>/
export function userDataDir(): string {
  return app.getPath('userData')
}

export function dbPath(): string {
  return join(userDataDir(), 'library.db')
}

export function thumbnailsDir(): string {
  const dir = join(userDataDir(), 'thumbnails')
  mkdirSync(dir, { recursive: true })
  return dir
}
