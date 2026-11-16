# AGENTS.md

DSH 侧栏插件，用户说明见 [README.md](README.md)。本文件写给改代码的人和 agent。

## 结构

| 文件 | 作用 |
| --- | --- |
| `model.cjs` | 纯函数树模型：校验、建/改/删文件夹、移动、行排序与分页、多选、活动统计。不碰 DOM、不碰存储 |
| `storage.cjs` | `createStore(storage, key)`：快照校验、写入、跨窗口冲突检测、移动撤销（仅内存，最多 30 步）；`openHostStorage(url)`：浏览器端的 host 存储客户端（加载、按序写入、冲突回退、`refresh()`） |
| `client-source.cjs` | React UI 与 DSH 接入：slot 覆盖、侧栏树、对话框、设置开关、样式 |
| `build.cjs` | 把上面三个文件打包成 `client.js` |
| `client.js` | **生成文件，不要手改** |
| `index.js` | Host 入口：注册 exact 路由 `/dsh-session-manager/storage`，把插件数据存在 `$DSH_HOME/session-manager/storage.json` |
| `package.json` / `cordis.patch.yml` / `locale/*.json` / `icon.svg` | 插件清单与元数据 |
| `.npmrc` / `.gitignore` / `LICENSE` | 发布相关，故意提交。`.npmrc` 只有一行 `registry=https://registry.npmjs.org/`，防止本机全局镜像把 publish 打到镜像站；**不要往里放 token** |

无 npm 依赖。运行时 React 和 `@deepseek-ai/dsh-client-ui-primitives` 由 DSH module loader 提供（`hostRequire`），不要引入其他包。

## 命令

```powershell
node build.cjs
node --check client.js
node --check index.js
node --test test/*.test.cjs
npm pack --dry-run --json --ignore-scripts
```

改了任何 `.cjs` 源码都要重新 `node build.cjs`，`test/bundle.test.cjs` 会检查 `client.js` 是否由当前源码生成。

生效方式看改的是哪一半：

- **只改前端**（`model.cjs` / `storage.cjs` / `client-source.cjs`）：构建后约 1 秒内自动重载，不用重启。`@deepseek-ai/dsh-client-hmr` 每 500ms 轮询 `client.js` 的 mtime/ctime/size，变化时销毁该插件条目再重新导入（页面刷新是兜底）。
- **改了 host 半截**（`index.js`）或**清单**（`package.json` / `cordis.patch.yml`）：完全退出 Desktop（包括托盘）再启动。

## 测试

- `model.test.cjs`、`activity.test.cjs`、`tags.test.cjs`、`storage.test.cjs`：模型与存储单元测试。
- `host.test.cjs`：host 路由（读写、乐观并发、请求栅栏）和浏览器端 host 存储客户端。
- `client.test.cjs`：用假 React 渲染器和模拟的 DSH ctx/primitives 测交互契约。**没有 DOM 和布局**，测不出 CSS 问题。
- `ui-regression.test.cjs`：对源码中的样式和关键调用做正则断言。
- `bundle.test.cjs`：清单、元数据、打包产物。

自动测试都不等于 Desktop 验收。交付时要写明哪些没有在 Desktop 里实际验证。

## 接入方式

- 以 `priority: -10` 注册 `sidebar.workspaces` slot 覆盖原生列表；关闭「使用树状列表」或探测失败时注销，原生列表自动恢复。
- `slots.register(options, component)` 返回的条目里，`inject` / `children` / `locale` 挂在条目上（`entry.inject`），不在 `options` 里。用 `entries().find(e => e.options.inject)` 找会静默拿到 `undefined`。
- `discover()` 从原生 slot 的 `inject()` 取重命名、归档回调。这不是公开 API（源码里标了 `shortcut:`），DSH 升级后先确认它还能拿到；拿不到必须退回原生列表，不能半残地渲染。
  - 0.2.2 起内置归档不再是 `sidebar.workspaces.session.menu.item` 的 slot 条目，改为 `ctx.uiWorkspace.archiveSession` + `sidebar.workspaces.session.row.action` 里的悬停按钮。`discover()` 按「row.action → menu.item → `uiWorkspace.archiveSession`」顺序取，并对这两个 slot 都订阅 reconcile。
- 弹窗锚点用 `anchor`（元素）或 `anchorPoint`（`{x, y}` 视口坐标）。`getAnchorRect` 在 rc.3 已删除，传了会被静默忽略、弹窗跑到默认位置；右键菜单传光标坐标，行内按钮弹窗传元素。`useAnchoredPosition` 也一起删了。
- 客户端 primitives 的 API 会随版本增删且不报错。升级 DSH 后先跑一遍测试和 `ui-regression.test.cjs` 的锚点断言，别等用户报告弹窗位置不对。
- 打开、新建、重命名、归档、恢复、置顶会话一律走原生接口，插件不自己改会话数据。

## 约束

- **文件夹只是 UI 元数据**。不改会话格式、DSH 安装目录、工作区成员关系，也不能跨工作区移动。
- **数据存在 host 端，不在 localStorage**。DSH Desktop、DeepSeek Harness 等不同桌面壳各有自己的 localStorage，所以所有键都经 host 路由读写同一个文件。写入带 `previous`，与文件当前值不一致时返回 409 和最新数据，客户端回退并提示。路由只服务 owner peer（`connection.admit`），并要求 `x-dsh-plugin` 头。
- **存储格式 `dsh.session-manager.v1` 是兼容边界**。用户已有数据；要改结构就升版本号并写迁移，校验失败时绝不能覆盖旧数据。
- **CSS 全局生效，所有 class 必须用 `dsmgr-` 前缀**。插件样式不做隔离，`dsh-plugin-tool-management` 占用了 `.dsm-*`，曾经因此让文件夹名宽度变成 0、会话点不动（0.1.8–0.1.9）。`ui-regression.test.cjs` 有命名空间测试守着。`data-dsm-key` 是属性不是 class，不受影响。
- 加 `container-type` 或 `@container` 前，想清楚别的插件的 `@container` 规则会不会命中我们的元素。
- 会话点击不经过 `safe()` 的 busy 锁，导航不能被其他异步操作卡住。
- 视觉对齐原生：用主题变量（`--dsw-*`）和原生组件，不硬编码颜色、不强制字重。
- 错误不能静默吞掉：至少 `report()` 到控制台，需要用户知道的用 `setMessage`。

## 发版

只在 `package.json` 改版本号。README 不记版本和变更历史，功能或行为变了才更新对应段落。

包名是 `@yuxhangz/dsh-session-manager`（npm scope `yuxhangz`，GitHub 是 `XinAnzzZ`，两个账号不同是正常的）。下面三个名字必须一致，`build.cjs` 从 `package.json` 读 `name` 生成 loader id，所以只改 `package.json` 就不会漂：

1. `package.json` 的 `name`
2. `cordis.patch.yml` 的 `name:`（同一行的 `id:` 可以是短名）
3. `client.js` 里的 `window.__ModuleLoader__.load({ id })`

发布流程：

```powershell
node build.cjs; node --check client.js; node --check index.js; node --test test/*.test.cjs
npm pack --dry-run   # 确认 9 个文件、client.js 在列
npm publish          # 需要 2FA，交互式执行
```

- `npm whoami` 报 `E401` 说明 token 失效（npm 收紧 2FA 后旧 token 会批量作废），重新 `npm login`，别以为是被包名占用。`E403` 要求 2FA、`EOTP` 需要用浏览器授权，`--otp` 不被接受。
- 发布后几分钟内 404 是正常的（registry 异步处理）。
- 发布的是包，市场收录是另一回事：`awesome-dsh-plugin` 是人工审核的列表，一次 PR 只加一个 `data/plugins/<owner>__<repo>.yml`，合并后还要等每日索引重建。
