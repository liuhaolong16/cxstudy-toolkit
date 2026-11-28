/**
 * 统一的配置目录解析。
 *
 * ## 默认
 *
 *   `~/.cxstudy-toolkit`（遵循 Unix 惯例，跨平台）
 *
 * **开源项目不能用某个固定盘符**——别人的 home 不在 D 盘，写死路径直接跑不起来。
 *
 * ## 覆盖
 *
 *   环境变量 `CXA_HOME` 优先。想放到别的盘就设它：
 *
 *     Windows:  setx CXA_HOME "D:\DeepSeek\_cxstudy"
 *     macOS/Linux: export CXA_HOME="$HOME/.cxstudy-toolkit"
 *
 * 项目里的**产物**（课表、日志、下载的课件）本来就走命令行参数指定位置，
 * 只有**配置与凭证**（cookie、通知 key）放这里。
 *
 * ## 为什么凭证不该散落
 *
 * cookie 与通知 key 都是"能以你身份操作"的东西。放一处，权限好收紧，
 * 备份与清理也只盯一个地方。
 */
import os from 'node:os';
import path from 'node:path';

const DEFAULT_DIR = path.join(os.homedir(), '.cxstudy-toolkit');

/** 配置目录（绝对路径）。每次读都重新算，`process.env` 改动后立即生效。 */
export function homeDir() {
  // CXA_HOME 是当前名字；CX_TOOLKIT_HOME 是早期版本用过、保留兼容
  const custom = process.env.CXA_HOME || process.env.CX_TOOLKIT_HOME;
  if (custom && custom.trim()) return path.resolve(custom.trim());
  return DEFAULT_DIR;
}

/** 配置目录下的文件 */
export function homePath(...parts) {
  return path.join(homeDir(), ...parts);
}

/**
 * 配置目录是否落在系统盘（Windows 上的 C:）。
 *
 * 只用于**提示**，不阻断——很多人不在意，也没义务迁。开源项目不该在运行时
 * 因为"你把配置放 C 盘了"就拒绝工作。
 */
export function onSystemDrive() {
  if (process.platform !== 'win32') return false;
  const dir = homeDir();
  const m = dir.match(/^([A-Za-z]):/);
  if (!m) return false;
  const sysDrive = (process.env.SystemDrive || 'C:').replace(':', '');
  return m[1].toUpperCase() === sysDrive.toUpperCase();
}

/** 一句提示（仅在命中 onSystemDrive 且用户没设 CXA_HOME 时用） */
export function systemDriveHint() {
  if (!onSystemDrive() || process.env.CXA_HOME) return null;
  return (
    `配置目录在系统盘：${homeDir()}\n` +
    `  想换到别的盘：setx CXA_HOME "D:\\你的目录" 然后重开终端`
  );
}
