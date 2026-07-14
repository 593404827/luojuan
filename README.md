# 落卷真实应用开发版

这个目录是 `落卷` 的真实 Next.js 应用，不再只是高保真原型。

## 当前能力

- 首页、新章节入口、随机提问、主动讲述、继续补写
- 整理结果页、成书页、章节详情页
- 社区页、看作品页
- 单用户私有版登录、退出与会话校验
- Capacitor App 封装底座 + Android 原生工程
- 服务端 `/api/chat`，支持 DeepSeek 与本地 mock 双模式
- 服务端 `/api/app-state`，支持：
  - 配置 Supabase 时走云端存储
  - 未配置时落到本地 `data/luojuan-app-state.json`

## 本地运行

```bash
npm install
npm run dev
```

## 环境变量

复制一份：

```bash
cp .env.example .env.local
```

至少可选填这些：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
CAPACITOR_SERVER_URL=你的开发地址或线上地址
SINGLE_USER_USERNAME=你的单用户账号
SINGLE_USER_PASSWORD=你的单用户密码
AUTH_SESSION_SECRET=一段足够长的随机字符串
```

如果要接入 Supabase，再补：

```bash
NEXT_PUBLIC_SUPABASE_URL=你的 Supabase Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的 Supabase anon key
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service role key
```

## Supabase 初始化

在 Supabase SQL Editor 中执行：

`supabase/schema.sql`

执行完成后，应用会把：

- 书的信息存到 `books`
- 章节内容存到 `chapters`
- 三类对话流存到 `conversations`

## 当前存储策略

- **开发阶段**：没配 Supabase 时，自动落本地 JSON 文件，方便先开发不被环境卡住
- **上线阶段**：配好 Supabase 后，自动切换到云端存储

## 单用户登录说明

- 当前版本默认是**单用户私有版**
- 不支持注册，只保留一个账号和一个密码
- 未配置时，会使用开发默认账号做本地兜底
- 正式上线前，请务必在 `.env.local` 中替换：
  - `SINGLE_USER_USERNAME`
  - `SINGLE_USER_PASSWORD`
  - `AUTH_SESSION_SECRET`

## App 封装

项目已经接入 `Capacitor` 并生成 `android/` 工程。

常用命令：

```bash
npm run cap:sync
npm run cap:open:android
```

详细说明见：

`docs/app-packaging.md`

## 建议的下一步

1. 接入真实 DeepSeek API Key
2. 在真机上测试分享、输入和对话节奏
3. 接入正式 Supabase 或本地数据库方案
4. 产出第一版可安装 Android 测试包
