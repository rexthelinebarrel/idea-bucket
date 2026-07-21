// 灵感图谱：类 Obsidian 的网络视图。节点=灵感（颜色随状态），实线=已确认连接，虚线=AI 建议。
// 布局：本地力导向模拟（节点斥力 + 边引力 + 向心重力 + 温度退火），一次算完静态渲染；
// 单指拖动平移画布，点节点跳详情，右下角按钮复位。
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';

import { colors, radius, STATUS, type IdeaStatus } from '@/theme';
import { listIdeas, listAllConnections, listActiveCandidates, type Idea } from '@/lib/db';

interface GNode {
  id: string;
  title: string;
  status: IdeaStatus;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

interface GEdge {
  a: number;
  b: number;
  pending: boolean;
}

interface Pair {
  a: string;
  b: string;
}

/** Fruchterman-Reingold 力导向布局：斥力让节点散开，边引力让关联聚拢，重力防止漂远 */
function layout(
  ideas: Idea[],
  conns: Pair[],
  cands: Pair[],
  width: number,
  height: number,
): { nodes: GNode[]; edges: GEdge[] } {
  const n = ideas.length;
  const nodes: GNode[] = ideas.map((idea, i) => {
    // 初始环形散布，避免全挤在原点导致斥力对称卡死
    const angle = (i / Math.max(n, 1)) * Math.PI * 2;
    const r = Math.min(width, height) * 0.3;
    return {
      id: idea.id,
      title: idea.title,
      status: idea.status,
      x: width / 2 + r * Math.cos(angle),
      y: height / 2 + r * Math.sin(angle),
      vx: 0,
      vy: 0,
      degree: 0,
    };
  });
  const indexOf = new Map(nodes.map((nd, i) => [nd.id, i]));
  const edges: GEdge[] = [];
  for (const c of conns) {
    const a = indexOf.get(c.a);
    const b = indexOf.get(c.b);
    if (a != null && b != null) {
      edges.push({ a, b, pending: false });
      nodes[a].degree += 1;
      nodes[b].degree += 1;
    }
  }
  for (const c of cands) {
    const a = indexOf.get(c.a);
    const b = indexOf.get(c.b);
    if (a != null && b != null) edges.push({ a, b, pending: true });
  }
  if (n < 2) return { nodes, edges };

  // 节点多时迭代降档，保证低端机也不卡
  const iterations = n > 200 ? 100 : 220;
  const k = Math.sqrt((width * height) / n) * 0.85; // 理想间距
  let temp = Math.min(width, height) / 6; // 退火温度：早期大步长，后期微扰

  for (let t = 0; t < iterations; t++) {
    // 斥力（全对）
    for (let i = 0; i < n; i++) {
      let fx = 0;
      let fy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.max(Math.hypot(dx, dy), 0.01);
        const force = (k * k) / dist;
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }
      nodes[i].vx = fx;
      nodes[i].vy = fy;
    }
    // 边引力
    for (const e of edges) {
      const A = nodes[e.a];
      const B = nodes[e.b];
      const dx = A.x - B.x;
      const dy = A.y - B.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      A.vx -= fx;
      A.vy -= fy;
      B.vx += fx;
      B.vy += fy;
    }
    // 向心重力 + 位移（步长受温度限制）
    for (const nd of nodes) {
      nd.vx += (width / 2 - nd.x) * 0.02;
      nd.vy += (height / 2 - nd.y) * 0.02;
      const v = Math.max(Math.hypot(nd.vx, nd.vy), 0.01);
      const step = Math.min(v, temp);
      nd.x += (nd.vx / v) * step;
      nd.y += (nd.vy / v) * step;
      nd.x = Math.max(48, Math.min(width - 48, nd.x));
      nd.y = Math.max(48, Math.min(height - 48, nd.y));
      nd.vx = 0;
      nd.vy = 0;
    }
    temp *= 0.96;
  }
  return { nodes, edges };
}

export default function GraphScreen() {
  const { width, height } = useWindowDimensions();
  const graphHeight = Math.max(height - 140, 320);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [conns, setConns] = useState<Pair[]>([]);
  const [cands, setCands] = useState<Pair[]>([]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  useFocusEffect(
    useCallback(() => {
      setIdeas(listIdeas());
      setConns(listAllConnections());
      setCands(listActiveCandidates());
    }, []),
  );

  const { nodes, edges } = useMemo(
    () => layout(ideas, conns, cands, width, graphHeight),
    [ideas, conns, cands, width, graphHeight],
  );

  // PanResponder 回调里拿不到最新 state，用 ref 中转
  const panRef = useRef(pan);
  panRef.current = pan;
  const panner = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        panStart.current = { ...panRef.current };
      },
      onPanResponderMove: (_e, g) => {
        setPan({ x: panStart.current.x + g.dx, y: panStart.current.y + g.dy });
      },
    }),
  ).current;

  const edgeCount = edges.filter((e) => !e.pending).length;
  const candCount = edges.length - edgeCount;

  return (
    <View style={styles.container}>
      {ideas.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>桶还是空的，先回去丢几个灵感进来</Text>
        </View>
      ) : (
        <View style={styles.canvas} {...panner.panHandlers}>
          <Svg width={width} height={graphHeight}>
            <G x={pan.x} y={pan.y}>
              {edges.map((e, i) => (
                <Line
                  key={`e${i}`}
                  x1={nodes[e.a].x}
                  y1={nodes[e.a].y}
                  x2={nodes[e.b].x}
                  y2={nodes[e.b].y}
                  stroke={e.pending ? colors.textDim : colors.primary}
                  strokeWidth={e.pending ? 1 : 1.6}
                  strokeOpacity={e.pending ? 0.35 : 0.75}
                  strokeDasharray={e.pending ? '5 5' : undefined}
                />
              ))}
              {nodes.map((nd) => {
                const r = 9 + Math.min(nd.degree, 5) * 2.5;
                return (
                  <G key={nd.id}>
                    <Circle
                      cx={nd.x}
                      cy={nd.y}
                      r={r}
                      fill={STATUS[nd.status].color}
                      fillOpacity={0.92}
                      stroke={nd.degree > 0 ? colors.accent : 'transparent'}
                      strokeWidth={1.5}
                      onPress={() => router.push(`/idea/${nd.id}`)}
                    />
                    <SvgText
                      x={nd.x}
                      y={nd.y + r + 14}
                      fontSize={11}
                      fill={colors.textDim}
                      textAnchor="middle"
                    >
                      {nd.title.length > 10 ? `${nd.title.slice(0, 10)}…` : nd.title}
                    </SvgText>
                  </G>
                );
              })}
            </G>
          </Svg>
          <Pressable style={styles.resetBtn} onPress={() => setPan({ x: 0, y: 0 })}>
            <Text style={styles.resetText}>复位</Text>
          </Pressable>
        </View>
      )}
      <Text style={styles.legend}>
        {edgeCount} 条已连接 · {candCount} 条 AI 建议（虚线） · 拖动平移，点节点看详情
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  canvas: { flex: 1, overflow: 'hidden' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textDim, fontSize: 15 },
  legend: {
    color: colors.textDim,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  resetBtn: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  resetText: { color: colors.text, fontSize: 13 },
});
