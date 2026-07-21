// 新版本主动推送：冷启动检查版本清单，发现新版本弹系统通知（每个版本只推一次）。
// 通知点击跳设置页走"下载并安装 → 系统确认"流程。真正的后台定时检查（免开 App）
// 属第二阶段，目前靠日常使用时的冷启动覆盖。
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { fetchLatestRelease, hasNewerRelease } from './release';
import { getSetting, setSetting, logEvent } from './db';

const NOTIFIED_KEY = 'update_notified_version';
const PERM_ASKED_KEY = 'notif_perm_asked';
const CHANNEL_ID = 'updates';

// 前台收到通知时也显示（默认前台不弹）
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '版本更新',
      importance: Notifications.AndroidImportance.HIGH,
    });
  } catch {
    // 忽略
  }
}

/** 请求通知权限（只主动问一次，被拒绝后不再打扰） */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (getSetting(PERM_ASKED_KEY)) return false;
    setSetting(PERM_ASKED_KEY, '1');
    const res = await Notifications.requestPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

export async function checkForUpdateAndNotify(): Promise<void> {
  try {
    const info = await fetchLatestRelease();
    if (!hasNewerRelease(info)) return;
    if (getSetting(NOTIFIED_KEY) === info.version) return; // 这个版本已推过
    const granted = await ensureNotificationPermission();
    if (!granted) return;
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `灵感桶新版本 ${info.version}`,
        body: `${info.notes || '有新版本可用'}（点我去更新）`,
        data: { navigateTo: '/settings' },
      },
      trigger: null, // 立即弹出
    });
    setSetting(NOTIFIED_KEY, info.version);
    logEvent('update', `已推送新版本通知 ${info.version}`);
  } catch (e) {
    logEvent('update', `启动检查更新失败: ${e instanceof Error ? e.message : String(e)}`, 'warn');
  }
}
