import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/theme';

export default function RootLayout() {
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
