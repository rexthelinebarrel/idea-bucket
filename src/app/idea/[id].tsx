// 灵感详情：原文 + 音频回放 + AI 讨论（展开/追问/对话）+ 关联 + 状态切换 + 删除
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { colors, STATUS, type IdeaStatus } from '@/theme';
import {
  getIdea,
  updateIdea,
  softDeleteIdea,
  listConnectedIdeas,
  removeConnection,
  addMessage,
  listMessages,
  type Idea,
  type ChatMessage,
} from '@/lib/db';
import { StatusBadge } from '@/components/status-badge';
import { fmtDateTime } from '@/lib/format';
import { processIdea } from '@/lib/pipeline';
import { getAISettings, analyzeIdea, chatAboutIdea, type IdeaAnalysis } from '@/lib/ai';

export default function IdeaDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [idea, setIdea] = useState<Idea | null>(null);
  const [connected, setConnected] = useState<Idea[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [analysis, setAnalysis] = useState<IdeaAnalysis | null>(null);
  const [busy, setBusy] = useState<'analyze' | 'chat' | 'retry' | null>(null);
  const [draft, setDraft] = useState('');

  const player = useAudioPlayer(idea?.audioUri ? { uri: idea.audioUri } : undefined);
  const playerStatus = useAudioPlayerStatus(player);

  const load = useCallback(() => {
    if (!id) return;
    const it = getIdea(id);
    setIdea(it);
    if (it) {
      setConnected(listConnectedIdeas(id));
      setMessages(listMessages(id));
      if (it.aiAnalysis) {
        try {
          setAnalysis(JSON.parse(it.aiAnalysis));
        } catch {
          setAnalysis(null);
        }
      }
    }
  }, [id]);

  useFocusEffect(load);

  function togglePlay() {
    if (playerStatus.playing) {
      player.pause();
    } else {
      if (playerStatus.didJustFinish) player.seekTo(0).catch(() => {});
      player.play();
    }
  }

  async function runAnalyze() {
    if (!idea || busy) return;
    if (!idea.transcript) {
      Alert.alert('还没有转写文本', '转写完成后才能 AI 展开。');
      return;
    }
    setBusy('analyze');
    try {
      const result = await analyzeIdea(idea.title, idea.transcript, getAISettings());
      updateIdea(idea.id, { aiAnalysis: JSON.stringify(result) });
      setAnalysis(result);
      setIdea({ ...idea, aiAnalysis: JSON.stringify(result) });
    } catch (e) {
      Alert.alert('AI 展开失败', e instanceof Error ? e.message : '请检查设置中的 API 配置');
    } finally {
      setBusy(null);
    }
  }

  async function sendChat() {
    const text = draft.trim();
    if (!text || !idea || busy) return;
    setDraft('');
    addMessage(idea.id, 'user', text);
    setMessages(listMessages(idea.id));
    setBusy('chat');
    try {
      const history = listMessages(idea.id).map((m) => ({ role: m.role, content: m.content }));
      const reply = await chatAboutIdea(
        { title: idea.title, transcript: idea.transcript, aiAnalysis: idea.aiAnalysis },
        history,
        getAISettings(),
      );
      addMessage(idea.id, 'assistant', reply);
    } catch (e) {
      addMessage(
        idea.id,
        'assistant',
        `⚠️ ${e instanceof Error ? e.message : '请求失败，请检查设置中的 API 配置'}`,
      );
    } finally {
      setMessages(listMessages(idea.id));
      setBusy(null);
    }
  }

  async function retryTranscribe() {
    if (!idea || busy) return;
    setBusy('retry');
    await processIdea(idea.id);
    const fresh = getIdea(idea.id);
    load();
    setBusy(null);
    if (fresh?.transcribeState === 'failed') {
      Alert.alert(
        '转写仍然失败',
        '云端转写需要先在「设置」配置 API Key（国内推荐硅基流动，免费）。',
      );
    }
  }

  function confirmDelete() {
    Alert.alert('删除灵感', '删除后进入回收站，30 天内可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          if (idea) {
            softDeleteIdea(idea.id);
            router.back();
          }
        },
      },
    ]);
  }

  if (!idea) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>灵感不存在或已删除</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{idea.title}</Text>
        <Text style={styles.time}>{fmtDateTime(idea.createdAt)} 入桶</Text>

        {/* 状态流转 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusRow}>
          {(Object.keys(STATUS) as IdeaStatus[]).map((key) => (
            <Pressable
              key={key}
              style={[styles.statusChip, idea.status === key && styles.statusChipActive]}
              onPress={() => {
                updateIdea(idea.id, { status: key });
                setIdea({ ...idea, status: key });
              }}
            >
              <Text
                style={[styles.statusChipText, idea.status === key && styles.statusChipTextActive]}
              >
                {STATUS[key].label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* 音频回放 */}
        <View style={styles.card}>
          <Pressable style={styles.playButton} onPress={togglePlay}>
            <Text style={styles.playIcon}>{playerStatus.playing ? '⏸' : '▶️'}</Text>
          </Pressable>
          <Text style={styles.dim}>原始录音</Text>
        </View>

        {/* 转写原文 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>原文</Text>
          {idea.transcribeState === 'pending' && <Text style={styles.dim}>转写中…</Text>}
          {idea.transcribeState === 'failed' && (
            <View>
              <Text style={styles.warn}>⚠️ 转写失败（可能未配置 API Key 或网络异常）</Text>
              <Pressable style={styles.smallButton} onPress={retryTranscribe} disabled={busy !== null}>
                {busy === 'retry' ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Text style={styles.smallButtonText}>重试转写</Text>
                )}
              </Pressable>
            </View>
          )}
          {idea.transcribeState === 'ok' && <Text style={styles.body}>{idea.transcript}</Text>}
        </View>

        {/* AI 讨论 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>AI 讨论</Text>
          {!analysis && (
            <Pressable style={styles.smallButton} onPress={runAnalyze} disabled={busy !== null}>
              {busy === 'analyze' ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Text style={styles.smallButtonText}>✨ 展开 / 追问这条灵感</Text>
              )}
            </Pressable>
          )}
          {analysis && (
            <View style={styles.analysis}>
              {!!analysis.summary && <Text style={styles.body}>{analysis.summary}</Text>}
              {analysis.points.length > 0 && (
                <View style={styles.block}>
                  <Text style={styles.blockTitle}>核心要点</Text>
                  {analysis.points.map((p, i) => (
                    <Text key={i} style={styles.bullet}>
                      • {p}
                    </Text>
                  ))}
                </View>
              )}
              {analysis.questions.length > 0 && (
                <View style={styles.block}>
                  <Text style={styles.blockTitle}>追问</Text>
                  {analysis.questions.map((q, i) => (
                    <Text key={i} style={styles.bullet}>
                      ❓ {q}
                    </Text>
                  ))}
                </View>
              )}
              {analysis.expansions.length > 0 && (
                <View style={styles.block}>
                  <Text style={styles.blockTitle}>可展开的方向</Text>
                  {analysis.expansions.map((e, i) => (
                    <Text key={i} style={styles.bullet}>
                      💡 {e}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}

          {messages.map((m) => (
            <View key={m.id} style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAI]}>
              <Text style={styles.bubbleText}>{m.content}</Text>
            </View>
          ))}
          {busy === 'chat' && (
            <View style={[styles.bubble, styles.bubbleAI]}>
              <ActivityIndicator color={colors.accent} size="small" />
            </View>
          )}

          <View style={styles.chatRow}>
            <TextInput
              style={styles.chatInput}
              placeholder="继续聊这条灵感…"
              placeholderTextColor={colors.textDim}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={sendChat}
              returnKeyType="send"
            />
            <Pressable style={styles.sendButton} onPress={sendChat} disabled={busy !== null}>
              <Text style={styles.sendButtonText}>发送</Text>
            </Pressable>
          </View>
        </View>

        {/* 关联灵感 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>关联灵感</Text>
          {connected.length === 0 && <Text style={styles.dim}>还没有关联，把相关的灵感连起来</Text>}
          {connected.map((c) => (
            <View key={c.id} style={styles.connRow}>
              <Pressable style={styles.connMain} onPress={() => router.push(`/idea/${c.id}`)}>
                <Text style={styles.connTitle} numberOfLines={1}>
                  {c.title}
                </Text>
                <StatusBadge status={c.status} />
              </Pressable>
              <Pressable
                onPress={() => {
                  removeConnection(idea.id, c.id);
                  setConnected(listConnectedIdeas(idea.id));
                }}
              >
                <Text style={styles.connRemove}>✕</Text>
              </Pressable>
            </View>
          ))}
          <Pressable style={styles.smallButton} onPress={() => router.push(`/connect/${idea.id}`)}>
            <Text style={styles.smallButtonText}>＋ 关联到其他灵感</Text>
          </Pressable>
        </View>

        <Pressable style={styles.deleteButton} onPress={confirmDelete}>
          <Text style={styles.deleteText}>删除（30 天反悔期）</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  time: { fontSize: 13, color: colors.textDim, marginTop: -6 },
  dim: { color: colors.textDim, fontSize: 14 },
  warn: { color: colors.danger, fontSize: 14, marginBottom: 8 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  statusRow: { flexDirection: 'row', flexGrow: 0 },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.card,
    marginRight: 8,
  },
  statusChipActive: { backgroundColor: colors.accent },
  statusChipText: { fontSize: 13, color: colors.textDim },
  statusChipTextActive: { color: '#1A1206', fontWeight: '600' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.textDim },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { fontSize: 20 },
  smallButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    minWidth: 80,
    alignItems: 'center',
  },
  smallButtonText: { color: colors.accent, fontSize: 14 },
  analysis: { gap: 8 },
  block: { gap: 4 },
  blockTitle: { fontSize: 14, fontWeight: '600', color: colors.accent, marginTop: 4 },
  bullet: { color: colors.text, fontSize: 14, lineHeight: 21 },
  bubble: {
    borderRadius: 12,
    padding: 10,
    maxWidth: '88%',
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#2B3A4E',
  },
  bubbleAI: {
    alignSelf: 'flex-start',
    backgroundColor: colors.bg,
  },
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  chatRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  chatInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 14,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  sendButtonText: { color: '#1A1206', fontWeight: '600', fontSize: 14 },
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connTitle: { flex: 1, color: colors.text, fontSize: 14 },
  connRemove: { color: colors.danger, fontSize: 16, padding: 4 },
  deleteButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  deleteText: { color: colors.danger, fontSize: 14 },
});
