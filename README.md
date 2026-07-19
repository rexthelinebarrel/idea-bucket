# 灵感桶 (Idea Bucket)

> 按住说话，松手即走。AI 帮你展开、追问、连接，让每一个灵感发芽而不是烂掉。

为创作者打造的随身灵感捕捉 + AI 讨论工具。语音输入把记录门槛降到 5 秒，AI 负责对灵感展开和追问——冷启动第一天就有价值。

## 为什么做这个

备忘录能记，但不帮你思考；ChatGPT 语音对话是"你去问它"，不是"它在你的灵感库里工作"。灵感桶的核心动作是**"放入"**——东西扔进桶里，AI 帮你发现它和其他灵感的关系。

- **极简投入 > 完美记录**：松手即入桶，音频先落盘，转写异步补，弱网不阻塞
- **桶不是收纳盒，是策展人**：桶越大，用户越不应该翻，AI 替你翻
- **灵感不会"没用"**：不真正删除，30 天反悔期，灵感只是时机未到

## 特性（v1）

- 🎤 **极简语音投入**：首屏一个按钮，按住说话松手即走（≤5 秒）
- 🏷️ **标题自动生成**：本地算法当场出标题 `[MM/DD] 关键词1·关键词2·关键词3`，不等 AI
- 💬 **AI 讨论**：对单条灵感做要点展开 + 追问，支持多轮对话 bounce ideas（不依赖桶里有其他灵感）
- 🔗 **手动关联**：把相关的灵感连起来
- 📋 **列表浏览**：推荐优先 / 时间倒序 / 按状态，支持全文搜索与状态筛选
- 🗂 **状态流转**：🌱原始 → 🔗已连接 → 🎯待开工 → 🏗️进行中 → ✅完成
- 🗑 **回收站**：删除后 30 天反悔期，到期自动彻底清除
- 🔒 **本地优先**：数据（SQLite）与音频均在本机；API Key 只存本机数据库，代码中无任何硬编码密钥

## 快速开始

```bash
npm install
npx expo start
```

手机安装 [Expo Go](https://expo.dev/go)，扫终端里的二维码即可使用（Android / iOS）。

然后在 App 的「设置」页填写 AI 服务配置（转写 + 讨论都依赖它）：

| 配置项 | 说明 |
|---|---|
| API 地址 | OpenAI 兼容接口地址，默认 `https://api.openai.com/v1` |
| API Key | 你的 key，仅保存在本机 |
| 对话模型 | 如 `gpt-4o-mini` |
| 转写模型 | 如 `whisper-1` |

任何 OpenAI 兼容服务都能接入。例如 Groq（有免费额度）：地址填 `https://api.groq.com/openai/v1`，转写模型填 `whisper-large-v3`。

### 国内用户（无需 Whisper API）

- **免配置开箱即用**：默认转写模式是「系统识别」，直接调用手机自带的语音识别（小米/华为等国产机自带中文引擎），不需要任何 Key。
- **想要云端转写**：推荐[硅基流动](https://siliconflow.cn)（国内直连、有免费额度），API 地址填 `https://api.siliconflow.cn/v1`，转写模型以控制台为准（如 `FunAudioLLM/SenseVoiceSmall`），对话模型可填免费的 Qwen 系列。
- 转写模式在 App「设置」页随时切换。

打正式 APK：

```bash
npx eas build --platform android --profile preview   # 需要 Expo 账号，产物为可直装的 APK
```

推送 OTA 热更新（JS/资源改动，不重装 APK）：

```bash
npx eas update --branch preview --environment preview --platform android -m "更新说明"
# 注意：必须带 --platform android。本项目不发布 web 端
# （expo-sqlite 的 web 依赖不完整，全平台导出会失败）。
```

## 技术栈

Expo SDK 57 · React Native · TypeScript · expo-router · expo-sqlite · expo-audio · OpenAI 兼容 API

## Roadmap

- **v1（当前）**：手机端 MVP —— 语音投入、标题生成、列表、AI 讨论、手动关联、回收站
- **v2**：图谱视图（Obsidian 风格）、AI 自动连接（合并/演化/碰撞）、每日定时推送、电脑端只读图谱 + 导出项目 .md、云同步

## 文档

- [PROJECT.md](./PROJECT.md) — 产品规格（含 v1 技术选型定稿）
- [AGENT_PROMPT.md](./AGENT_PROMPT.md) — 项目起源与决策记录，可直接作为上下文喂给 AI 编码助手

## License

[MIT](./LICENSE) © rexthelinebarrel
