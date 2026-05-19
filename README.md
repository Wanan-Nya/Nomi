# Nomi Mobile

Nomi Mobile 是一个基于 Expo + React Native 的 AI 移动应用，当前只支持通过中转站 API 接入。

## 功能

- 聊天
- 作图
- 事项簿
- 本地保存配置
- 左侧抽屉设置
- 长期记忆
- 多张参考图作图

## 目录结构

```text
Nomi Mobile/
├─ App.tsx
├─ app.json
├─ babel.config.js
├─ package.json
├─ tsconfig.json
├─ .env
├─ .env.example
└─ src/
   ├─ components/
   ├─ context/
   ├─ screens/
   ├─ services/
   └─ types.ts
```

## 主要文件

- `App.tsx`
  - 应用入口
  - 负责顶栏、侧边栏、页面切换和背景层
- `src/context/RelaySettingsContext.tsx`
  - 管理聊天、作图、头像和人设设置
  - 自动同步到 `AsyncStorage`
- `src/screens/ChatScreen.tsx`
  - 聊天页
  - 支持消息发送、附件、会话切换和长期记忆
- `src/screens/ImageScreen.tsx`
  - 作图页
  - 支持文生图和图生图
- `src/screens/SettingsScreen.tsx`
  - 设置页
  - 管理 API、模型、头像和背景
- `src/screens/TaskBoardScreen.tsx`
  - 事项簿页
  - 支持手动新增、原文解析和编辑事项卡片
- `src/services/relayApi.ts`
  - 封装聊天、文生图和图生图请求
- `src/services/longTermMemory.ts`
  - 长期记忆数据库、摘要和召回逻辑
- `src/services/taskBoard.ts`
  - 事项簿数据库、导入解析和聊天自动提取

## 启动方式

1. 安装依赖
2. 配置 `.env`
3. 启动开发服务：

```bash
npm run start:tunnel
```

4. 用手机上的 Expo Go 扫码打开

## 环境变量

当前项目只支持中转站 API。请在 `.env` 中配置以下变量：

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_API_KEY`
- `EXPO_PUBLIC_CHAT_MODEL`
- `EXPO_PUBLIC_IMAGE_MODEL`
- `EXPO_PUBLIC_CHAT_ENDPOINT`
- `EXPO_PUBLIC_IMAGE_ENDPOINT`
- `EXPO_PUBLIC_IMAGE_GENERATION_ENDPOINT`
- `EXPO_PUBLIC_IMAGE_EDIT_ENDPOINT`
- `EXPO_PUBLIC_AI_NAME`
- `EXPO_PUBLIC_AI_PERSONA`

说明：

- `EXPO_PUBLIC_API_BASE_URL` 应填写你的中转站地址
- `EXPO_PUBLIC_API_KEY` 应填写中转站提供的 key
- 当前代码不会直连官方 OpenAI 接口，只会走你配置的中转站
- `.env` 不会提交到仓库，仓库里只保留 `.env.example`

## 当前接口约定

- 聊天: `/v1/chat/completions`
- 文生图: `/v1/images/generations`
- 图生图: `/v1/images/edits`

如果你的中转服务路径不同，可以在设置页里修改 `baseUrl` 和相关端点。

## 安全说明

- 仓库不会包含你的真实 `API key`
- 只有你本地的 `.env` 会保存真实配置
- 如果你怀疑 key 泄露，应该立刻在中转站后台重新生成
