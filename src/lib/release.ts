// 版本清单与更新检查：jsDelivr 多镜像容灾。
// （GitHub 直连在国内手机不可达，release.json 走 jsDelivr CDN 镜像；某个节点缓存旧/不可达时自动换下一个）
import { APP_VERSION } from '@/version';

export interface ReleaseInfo {
  version: string;
  apkUrl: string;
  notes: string;
  publishedAt?: string;
}

const RELEASE_URLS = [
  'https://cdn.jsdelivr.net/gh/rexthelinebarrel/idea-bucket@master/release.json',
  'https://fastly.jsdelivr.net/gh/rexthelinebarrel/idea-bucket@master/release.json',
  'https://gcore.jsdelivr.net/gh/rexthelinebarrel/idea-bucket@master/release.json',
];

export function isNewer(remote: string, local: string): boolean {
  const a = remote.split('.').map(Number);
  const b = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

/** 依次尝试多个镜像拉取最新版本清单，全部失败才抛错 */
export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  let lastErr: unknown = null;
  for (const base of RELEASE_URLS) {
    try {
      const res = await fetch(`${base}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info = (await res.json()) as ReleaseInfo;
      if (!info?.version || !info?.apkUrl) throw new Error('清单格式异常');
      return info;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('版本清单拉取失败');
}

export function hasNewerRelease(info: ReleaseInfo): boolean {
  return isNewer(info.version, APP_VERSION);
}
