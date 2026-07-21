import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';

import { colors } from '@/theme';
import { logEvent } from '@/lib/db';
import { backfillKeywordsAndDetect } from '@/lib/pipeline';

// ErrorUtils 没有 react-native 具名导出，RN 运行时只挂在 global 上；
// 整条诊断逻辑包在 try/catch 里——诊断绝不能让 App 起不来。
function installCrashLogger() {
  try {
    const eu = (
      globalThis as {
        ErrorUtils?: {
          getGlobalHandler?: () => ((e: Error, f?: boolean) => void) | undefined;
          setGlobalHandler?: (h: (e: Error, f?: boolean) => void) => void;
        };
      }
    ).ErrorUtils;
    if (!eu?.getGlobalHandler || !eu?.setGlobalHandler) return;
    const prev = eu.getGlobalHandler();
    eu.setGlobalHandler((error: Error, isFatal?: boolean) => {
      try {
        logEvent('crash', `${isFatal ? 'FATAL' : 'js'} ${error?.message ?? String(error)}`, 'error');
      } catch {
        // 日志绝不影响主流程
      }
      if (typeof prev === 'function') prev(error, isFatal);
    });
  } catch {
    // 忽略
  }
}

export default function RootLayout() {
  useEffect(() => {
    try {
      logEvent(
        'app',
        `冷启动 v${Constants.expoConfig?.version ?? '?'} runtime=${Updates.runtimeVersion ?? '?'}`,
      );
      installCrashLogger();
      // 老灵感关键词回填 + 候选检测 + 终审批次（后台静默跑，失败不影响启动）
      backfillKeywordsAndDetect().catch(() => {});
    } catch {
      // 诊断绝不能让 App 起不来
    }
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="list" options={{ title: '灵感列表' }} />
        <Stack.Screen name="idea/[id]" options={{ title: '灵感详情' }} />
        <Stack.Screen name="connect/[id]" options={{ title: '建立关联' }} />
        <Stack.Screen name="settings" options={{ title: '设置' }} />
        <Stack.Screen name="recycle-bin" options={{ title: '回收站' }} />
      </Stack>
    </>
  );
}
