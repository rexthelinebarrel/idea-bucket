// 底部主导航：投入 / 灵感 / 图谱 / 设置。大改版的信息架构——
// 首页只留录音（极简投入），其余能力收进底栏，一眼可达。
import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { colors } from '@/theme';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={[styles.icon, !focused && styles.iconDim]}>{emoji}</Text>;
}

const styles = StyleSheet.create({
  icon: { fontSize: 21 },
  iconDim: { opacity: 0.4 },
});

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700', fontSize: 18, letterSpacing: 1 },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.cardBorder,
          borderTopWidth: 1,
          minHeight: 62,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', letterSpacing: 1 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '投入',
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon emoji="🎙" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: '灵感',
          tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="graph"
        options={{
          title: '图谱',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🕸" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ focused }) => <TabIcon emoji="⚙️" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
