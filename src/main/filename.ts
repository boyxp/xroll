import { Period } from '../shared/types'

// DJI_20260129100313_0195_D.MP4 → 精确到秒的拍摄时间
// 通用兜底：抓取文件名中任意 14 位连续数字 YYYYMMDDHHMMSS，或 8 位 YYYYMMDD
const RE_DJI = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/
const RE_DATE = /(\d{4})(\d{2})(\d{2})/

export interface ParsedShoot {
  shootAt: number | null // epoch ms
  shootDate: string | null // YYYY-MM-DD
  period: Period | null
}

export function parseShootFromName(fileName: string): ParsedShoot {
  const full = RE_DJI.exec(fileName)
  if (full) {
    const [, y, mo, d, h, mi, s] = full
    const dt = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s)
    )
    if (validDate(dt, +y, +mo, +d)) {
      return {
        shootAt: dt.getTime(),
        shootDate: ymd(y, mo, d),
        period: periodOf(Number(h))
      }
    }
  }
  const dOnly = RE_DATE.exec(fileName)
  if (dOnly) {
    const [, y, mo, d] = dOnly
    const dt = new Date(Number(y), Number(mo) - 1, Number(d))
    if (validDate(dt, +y, +mo, +d)) {
      return { shootAt: dt.getTime(), shootDate: ymd(y, mo, d), period: null }
    }
  }
  return { shootAt: null, shootDate: null, period: null }
}

// 解析失败时用文件 mtime 兜底
export function shootFromMtime(mtimeMs: number): ParsedShoot {
  const dt = new Date(mtimeMs)
  return {
    shootAt: mtimeMs,
    shootDate: ymd(
      String(dt.getFullYear()),
      String(dt.getMonth() + 1).padStart(2, '0'),
      String(dt.getDate()).padStart(2, '0')
    ),
    period: periodOf(dt.getHours())
  }
}

export function periodOf(hour: number): Period {
  if (hour >= 5 && hour < 8) return 'dawn'
  if (hour >= 8 && hour < 12) return 'am'
  if (hour >= 12 && hour < 18) return 'pm'
  return 'night'
}

function ymd(y: string | number, mo: string | number, d: string | number): string {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function validDate(dt: Date, y: number, mo: number, d: number): boolean {
  return (
    !isNaN(dt.getTime()) &&
    y >= 2000 &&
    y <= 2100 &&
    mo >= 1 &&
    mo <= 12 &&
    d >= 1 &&
    d <= 31
  )
}
