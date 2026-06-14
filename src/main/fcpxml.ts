import { pathToFileURL } from 'url'
import { basename } from 'path'
import { Material } from '../shared/types'

export interface ExportClip {
  material: Material
  fps: { num: number; den: number } // 帧率 num/den
  startTime?: { num: number; den: number } | null // 源时间码（秒，有理数），用于 asset/clip 的 start
  frames?: number | null // 视频流精确帧数（探测得到），优先于按时长四舍五入
}

// 生成 Final Cut Pro X 的 fcpxml（v1.9），按传入顺序拼成一条时间线。
// FCP 与 DaVinci Resolve 均可导入。时间值以序列帧率为基准换算为有理数。
export function buildFcpxml(programName: string, clips: ExportClip[]): string {
  // 序列时基取第一条素材的帧率；分辨率取首个有宽高的素材，回退 4K。
  const seq = clips[0]?.fps ?? { num: 60, den: 1 }
  const width = clips.find((c) => c.material.width)?.material.width ?? 3840
  const height = clips.find((c) => c.material.height)?.material.height ?? 2160

  // 每帧时长（秒）= den/num；F 帧 → F*den/num 秒
  const frameDuration = `${seq.den}/${seq.num}s`
  const framesOf = (sec: number | null): number => Math.max(1, Math.round(((sec ?? 0) * seq.num) / seq.den))
  const timeOf = (frames: number): string => `${frames * seq.den}/${seq.num}s`

  // NTSC 小数帧率（29.97/59.94/119.88）用丢帧时间码，与达芬奇一致；其余非丢帧。
  const rate = seq.num / seq.den
  const dropFrame = seq.den === 1001 && [30, 60, 120].includes(Math.round(rate))
  const tcFormat = dropFrame ? 'DF' : 'NDF'

  // 格式 id 用 r0、素材从 r1 起，与达芬奇导出一致。
  const resources: string[] = [
    `    <format id="r0" name="${formatName(width, height, rate)}" frameDuration="${frameDuration}" width="${width}" height="${height}"/>`
  ]
  const spine: string[] = []
  let offset = 0

  clips.forEach((c, i) => {
    const rid = `r${i + 1}`
    // 时长优先用探测到的视频精确帧数；缺失时回退按容器时长换算（会有 ±1 帧误差）
    const frames = c.frames && c.frames > 0 ? c.frames : framesOf(c.material.durationSec)
    const dur = timeOf(frames)
    // 资源名用完整文件名（含扩展名），与达芬奇导出一致 —— 这是达芬奇重链素材时
    // 按名匹配的字段，去掉扩展名/换成别名会导致「找不到素材」。
    const assetName = escapeXml(c.material.fileName)
    // 时间线上的片段名仍可用别名显示。
    const clipName = escapeXml(c.material.alias?.trim() || baseName(c.material.fileName))
    // 路径用标准百分号编码（与达芬奇自身导出的 src 字节一致）。
    const src = escapeXml(pathToFileURL(c.material.path).toString())
    // 源时间码：达芬奇按文件名+时间码套底，start 必须等于素材真实时间码；无则回退 0/1s。
    const start = c.startTime ? `${c.startTime.num}/${c.startTime.den}s` : '0/1s'
    resources.push(
      `    <asset id="${rid}" name="${assetName}" start="${start}" duration="${dur}" ` +
        `hasVideo="1" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000" format="r0">` +
        `<media-rep kind="original-media" src="${src}"/></asset>`
    )
    spine.push(
      `        <asset-clip ref="${rid}" offset="${timeOf(offset)}" name="${clipName}" start="${start}" ` +
        `duration="${dur}" enabled="1" tcFormat="${tcFormat}" format="r0">` +
        `<adjust-transform anchor="0 0" scale="1 1" position="0 0"/></asset-clip>`
    )
    offset += frames
  })

  const total = timeOf(offset)
  const ev = escapeXml(programName)

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
${resources.join('\n')}
  </resources>
  <library>
    <event name="${ev}">
      <project name="${ev}">
        <sequence format="r0" duration="${total}" tcStart="0/1s" tcFormat="${tcFormat}" audioLayout="stereo" audioRate="48k">
          <spine>
${spine.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`
}

// 生成达芬奇可识别的内置格式预设名，如 FFVideoFormat3840x2160p5994。
// 关键：name 以 "FFVideoFormat" 开头时 Resolve 会按预设解析，必须是完整有效名
// （含分辨率与帧率），否则格式解析失败 → 绑定该格式的素材全部离线（「找不到素材」）。
// 帧率：整数直接用（60/30/25/24），小数用百分位（59.94→5994、29.97→2997、23.976→2398）。
function formatName(w: number, h: number, rate: number): string {
  const isInt = Math.abs(rate - Math.round(rate)) < 1e-6
  const rateStr = isInt ? String(Math.round(rate)) : String(Math.round(rate * 100))
  return `FFVideoFormat${w}x${h}p${rateStr}`
}

function baseName(fileName: string): string {
  return basename(fileName).replace(/\.[^.]+$/, '')
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
