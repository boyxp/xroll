# 视频素材管理 · xroll

一款面向 YouTube 等自媒体创作者的 macOS **视频素材管理 + 预剪辑**工具。

把散落在各处的海量视频素材统一归集、浏览、筛选、打标签，先在轻量的"节目时间线"里完成**预剪辑**（挑片、排序、分组、定别名），再一键导出 FCPXML 交给 Final Cut Pro / DaVinci Resolve 做精剪。让前期的"找素材、理素材、搭框架"不再挤占正式剪辑的时间。

> 源片**永不移动**，始终原地引用；应用只在数据库里记录元信息与缩略图。删除应用不会动到你的素材。

界面为中文，遵循 macOS 视觉风格。

---

## 适合谁

- 拍得多、剪得久的 YouTuber / Vlogger / 自媒体团队
- 素材横跨多机位、多设备（相机、手机、无人机、屏录……）需要统一管理的人
- 想把"挑素材 + 搭片子结构"从剪辑软件里解放出来、在专门工具里高效完成的创作者

---

## 功能特性

- **批量导入不卡 UI** — 添加文件夹后分三段异步处理：扫描入库 → ffprobe 读取分辨率/编码/时长/码率 → ffmpeg 抽帧生成缩略图；进度实时回传。导入中断后下次启动自动续跑，适合一次性导入几百上千条素材。
- **智能拍摄时间** — 优先从文件名解析拍摄时间（如 `DJI_YYYYMMDDHHMMSS_...`），回退到文件 mtime，并据此自动归入早晨/上午/下午/晚上时段；文件夹自动继承首个片段的拍摄日期，方便按时间线回溯。
- **多维筛选** — 按状态、时段、日期、设备、地点、标签任意组合，快速从素材海里定位想要的片段。
- **网格 / 列表两种浏览** — 列表模式展示完整技术参数（分辨率、编码、码率、设备等）；缩略图悬停即可放大预览。
- **素材状态机** — 未用 → 已用 → 删除三态，"已用"由是否被节目引用自动推导，一眼看清哪些素材还没用过。
- **节目编排（预剪辑核心）** — 拖拽素材进节目，支持手动排序与按时间排序；Intro 自动置顶、同别名素材自动聚合成组，快速搭出片子骨架。
  - 列表模式下右键素材：选择/修改别名、移除素材、修改类型（A-roll / B-roll / Intro）。
  - 选中单条素材或整个分组后，可用 **↑/↓ 方向键**调序，列表自动跟随滚动。
- **导出 FCPXML** — 按节目当前顺序逐条探测帧率与源时间码，生成 Final Cut Pro / DaVinci Resolve 均可导入的 `.fcpxml`，预剪辑成果无缝带入精剪。
- **本地优先** — 所有数据存于本机 SQLite，缩略图与原始 4K 视频通过自定义 `media://` 协议流式播放（支持 range 请求），无需上传云端。

---

## 技术栈

Electron 33 · React 18 · TypeScript 5 · Tailwind CSS 3 · Zustand · better-sqlite3（WAL）· ffmpeg-static / ffprobe-static · electron-vite · electron-builder

---

## 开发

```bash
npm install        # 安装依赖（postinstall 会自动按 Electron ABI 重编译 better-sqlite3）
npm run dev        # 启动开发环境（渲染进程 HMR）
npm run build      # 类型检查 + 打包到 out/（不出安装包）
npm run dist       # 构建并用 electron-builder 生成 dist/视频素材管理-<版本>-arm64.dmg
npm run rebuild    # 单独按 Electron ABI 重编译 better-sqlite3
```

> ⚠️ `electron-vite dev` 对渲染进程 HMR 稳定，但修改 `src/main/**`（尤其 `db.ts` / `media.ts`）后不一定会重启主进程——改主进程代码后请重启 dev 服务，否则数据库迁移与 IPC 变更不会生效。

本项目**未配置测试与 lint**。"验证改动"即运行 `npm run dev` 在 UI 中实操。

---

## 架构

三个 TypeScript 构建目标（`electron.vite.config.ts`）：

| 目录 | 角色 |
| --- | --- |
| `src/main/` | Node/Electron 主进程：持有 SQLite、ffmpeg/ffprobe、文件系统与全部业务逻辑 |
| `src/preload/` | 通过 `contextBridge` 暴露唯一的 `window.api`（`Api` 类型），封装所有 IPC 调用与事件订阅 |
| `src/renderer/` | React + Tailwind + Zustand 单窗口界面，不直接接触文件系统或数据库 |
| `src/shared/types.ts` | 三端共享的数据模型——**了解领域从这里开始** |

数据流严格单向：

```
renderer → window.api.* → ipcMain.handle (src/main/ipc.ts) → db.ts / importer.ts / media.ts
```

- **数据库**：`src/main/db.ts`，表含 `folders` / `materials` / `tags` / `stages` / `programs` 等。
- **用户数据**位于仓库之外的 `~/Library/Application Support/视频素材管理/`（`library.db` + `thumbnails/<id>.jpg`）。

---

## 已知问题

- Chromium 可能无法直接播放 H.265/HEVC 视频（报 `Unsupported pixel format: -1`）。缩略图由独立的 ffmpeg CLI 生成，不受影响。
- DMG **未签名、未公证**，arm64 only。首次打开需在「系统设置 → 隐私与安全性」中允许运行。

---

## 许可证

[MIT](./LICENSE)
