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

/** 并发拉取全部镜像，取版本号最高的一份。
 *  不能"首个成功即返回"：jsDelivr 单节点可能长期缓存旧版本（HTTP 200 但数据陈旧），
 *  只有跨节点取最大版本号才可靠。 */
export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const results = await Promise.allSettled(
    RELEASE_URLS.map(async (base) => {
      const res = await fetch(`${base}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info = (await res.json()) as ReleaseInfo;
      if (!info?.version || !info?.apkUrl) throw new Error('清单格式异常');
      return info;
    }),
  );
  const valid = results
    .filter((r): r is PromiseFulfilledResult<ReleaseInfo> => r.status === 'fulfilled')
    .map((r) => r.value);
  if (valid.length === 0) throw new Error('版本清单拉取失败（所有镜像不可达）');
  valid.sort((a, b) => (isNewer(a.version, b.version) ? -1 : 1));
  return valid[0];
}

export function hasNewerRelease(info: ReleaseInfo): boolean {
  return isNewer(info.version, APP_VERSION);
}
