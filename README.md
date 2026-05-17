# Nomi Mobile

一个基于 Expo + React Native 的中文 AI 手机应用框架。

## 项目定位

这个项目现在分成两大能力：

1. 聊天
2. 作图

同时还支持：

1. 本地保存 API 配置
2. 左侧菜单进入设置页
3. 长期记忆
4. 多张参考图图生图

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
   │  ├─ ChatBubble.tsx
   │  ├─ HamburgerButton.tsx
   │  ├─ PrimaryButton.tsx
   │  ├─ SideDrawer.tsx
   │  └─ TabSwitch.tsx
   ├─ context/
   │  └─ RelaySettingsContext.tsx
   ├─ screens/
   │  ├─ ChatScreen.tsx
   │  ├─ ImageScreen.tsx
   │  └─ SettingsScreen.tsx
   ├─ services/
   │  ├─ longTermMemory.ts
   │  └─ relayApi.ts
   └─ types.ts
```

## 每个目录是干什么的

### 根目录

1. `App.tsx`
   - 应用入口
   - 负责控制页面切换、顶部标题、侧边栏和设置页

2. `app.json`
   - Expo 配置
   - 包含权限、应用名、图标、插件等

3. `package.json`
   - 依赖和启动命令

4. `tsconfig.json`
   - TypeScript 配置

5. `.env`
   - 你的本地环境变量
   - 适合放默认 API 地址、模型名等

### `src/components`

这里放可复用的小组件。

1. `HamburgerButton.tsx`
   - 左上角三条杠按钮

2. `SideDrawer.tsx`
   - 左侧抽屉菜单

3. `TabSwitch.tsx`
   - 聊天 / 作图模式切换

4. `PrimaryButton.tsx`
   - 通用主按钮

5. `ChatBubble.tsx`
   - 聊天气泡

### `src/context`

这里放全局状态。

1. `RelaySettingsContext.tsx`
   - 保存聊天 API、图片 API、AI 名称、人设等设置
   - 自动写入本地 `AsyncStorage`

### `src/screens`

这里放页面级组件。

1. `ChatScreen.tsx`
   - 聊天页面
   - 发送消息、展示对话、接入长期记忆

2. `ImageScreen.tsx`
   - 作图页面
   - 支持文生图和多图图生图

3. `SettingsScreen.tsx`
   - 设置页面
   - 修改聊天和作图配置、AI 名称、人设

### `src/services`

这里放和外部能力相关的逻辑。

1. `relayApi.ts`
   - 封装第三方中转站 API 请求
   - 统一处理聊天、文生图、图生图

2. `longTermMemory.ts`
   - 长期记忆
   - 本地 SQLite 存储
   - 摘要生成
   - 记忆召回

### `src/types.ts`

这里放类型定义。

1. 聊天消息类型
2. 图片 API 请求 / 响应类型
3. 图片尺寸、质量、返回格式等枚举类型

## 当前运行方式

1. 安装依赖
2. 配好 `.env`
3. 执行 `npm run start:tunnel`
4. 手机用 Expo Go 扫码打开

## 当前接口约定

默认按 OpenAI 兼容格式调用：

1. 聊天接口：`/v1/chat/completions`
2. 文生图接口：`/v1/images/generations`
3. 图生图接口：`/v1/images/edits`

如果你的中转站前缀不同，只要改设置里的 `baseUrl` 即可。

## 你现在最该看懂的主流程

1. 用户在 `App.tsx` 里看到主界面
2. `ChatScreen.tsx` 或 `ImageScreen.tsx` 负责具体功能
3. `RelaySettingsContext.tsx` 负责读取和保存配置
4. `relayApi.ts` 负责真正发请求
5. `longTermMemory.ts` 负责聊天记忆

## 开发建议

如果后面继续扩展，建议保持这个分层：

1. 页面逻辑放 `screens`
2. 可复用 UI 放 `components`
3. 全局状态放 `context`
4. 和接口、存储相关的逻辑放 `services`

这样项目会比较稳，也方便你继续往里加功能。

