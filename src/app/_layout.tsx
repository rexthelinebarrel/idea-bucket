import { useEffect } from 'react';
import { ErrorUtils } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';

import { colors } from '@/theme';
import { logEvent } from '@/lib/db';

export default function RootLayout() {
  useEffect(() => {
    logEvent(
      'app',
      `冷启动 v${Constants.expoConfig?.version ?? '?'} runtime=${Updates.runtimeVersion ?? '?'}`,
    );
    // 未捕获的 JS 错误落库，作为简易崩溃记录（随后交给系统默认处理器）
    const prev = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      try {
        logEvent('crash', `${isFatal ? 'FATAL' : 'js'} ${error?.message ?? String(error)}`, 'error');
      } catch {
        // 日志绝不影响主流程
      }
      prev?.(error, isFatal);
    });
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
