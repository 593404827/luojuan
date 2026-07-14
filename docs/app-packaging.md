# 落卷 App 封装说明

现在项目已经接入了 `Capacitor`，并生成了 `android/` 原生工程。

## 当前封装策略

这版 App 先采用“原生壳 + Web 服务地址”的方式：

- 前端和业务逻辑继续保留在当前 Next.js 项目里
- App 本身负责提供手机图标、原生容器和后续真机能力
- App 启动后会打开 `CAPACITOR_SERVER_URL` 指向的地址

这样做的好处是：

- 你可以继续高效地改网页逻辑
- 到一个阶段后，再同步到手机里真实测试
- 不需要现在就把整套 Next.js 改造成纯静态站

## 先在自己手机上测试

### 1. 找到你电脑的局域网 IP

假设你电脑 IP 是：

`192.168.31.20`

### 2. 本地启动 Next.js，并允许局域网访问

```bash
npm run dev -- --hostname 0.0.0.0 --port 3000
```

### 3. 在 `.env.local` 中加入

```bash
CAPACITOR_SERVER_URL=http://192.168.31.20:3000
```

这里的地址要替换成你自己电脑的实际局域网 IP。

### 4. 同步 Capacitor 配置

```bash
npm run cap:sync
```

### 5. 打开 Android 工程

```bash
npm run cap:open:android
```

然后在 Android Studio 里：

- 连接真机或启动模拟器
- 直接运行 `android` 工程

## 以后怎么继续改

最省事的方式是：

1. 平时继续改网页逻辑
2. 每次准备上手机真机测时：

```bash
npm run cap:sync
```

3. 再回 Android Studio 重新运行

## 真正给别人长期使用时

后面你有两个方向：

- 继续用 `CAPACITOR_SERVER_URL` 指向线上地址
- 或者再往下收，把前端静态资源和原生能力结合得更深

现阶段更推荐第一种，因为它最适合快速迭代。
