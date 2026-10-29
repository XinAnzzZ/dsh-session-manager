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

无 npm 依赖。运行时 React 和 `@deepseek-ai/dsh-client-ui-primitives` 由 DSH module loader 提供（`hostRequire`），不要引入其他包。

## 命令

```powershell
node build.cjs
node --check client.js
node --check index.js
node --test test/*.test.cjs
npm pack --dry-run --json --ignore-scripts
```

改了任何 `.cjs` 源码都要重新 `node build.cjs`，`test/bundle.test.cjs` 会检查 `client.js` 是否由当前源码生成。Desktop 里看效果必须完全退出（包括托盘）再启动。

## 测试

- `model.test.cjs`、`activity.test.cjs`、`tags.test.cjs`、`storage.test.cjs`：模型与存储单元测试。
- `host.test.cjs`：host 路由（读写、乐观并发、请求栅栏）和浏览器端 host 存储客户端。
- `client.test.cjs`：用假 React 渲染器和模拟的 DSH ctx/primitives 测交互契约。**没有 DOM 和布局**，测不出 CSS 问题。
- `ui-regression.test.cjs`：对源码中的样式和关键调用做正则断言。
- `bundle.test.cjs`：清单、元数据、打包产物。

自动测试都不等于 Desktop 验收。交付时要写明哪些没有在 Desktop 里实际验证。

## 接入方式

- 以 `priority: -10` 注册 `sidebar.workspaces` slot 覆盖原生列表；关闭「使用树状列表」或探测失败时注销，原生列表自动恢复。
- `discover()` 从原生 slot 的 `inject()` 取重命名、归档回调。这不是公开 API（源码里标了 `shortcut:`），DSH 升级后先确认它还能拿到；拿不到必须退回原生列表，不能半残地渲染。
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
