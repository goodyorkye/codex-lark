# codex-lark

用手机飞书/Lark 控制 Mac 上的 Codex Desktop 任务：不单独安装 Codex CLI，不开放公网 Web 服务，也不用手工进入飞书开发者后台创建机器人。

[English](README.md) · [架构](docs/ARCHITECTURE.md) · [安全](SECURITY.md) · [路线图](ROADMAP.md)

> 当前状态：macOS 早期预览版。App Server 主链路有自动化测试；Desktop IPC 镜像属于实验能力，因为它不是公开文档承诺的稳定接口。

## 能做什么

- 自动找到 `ChatGPT.app` 或 `Codex.app` 内置的 Codex 核心，绝不会退回去调用 `PATH` 里的 `codex` 命令。
- 读取 Codex 项目、任务列表、完整会话记录和当前可用模型。
- 从飞书新建任务、继续已有任务，并把文字、推理摘要、工具活动、用量和结果流式显示在卡片中。
- 支持图片和飞书附件；文件下载到 Mac 的隔离缓存后作为本地输入交给 Codex。
- 把命令执行、文件修改和权限申请显示为带签名的审批按钮。
- 可通过本机 Desktop IPC 同步 Mac 界面里已经开始的任务；这部分综合了 Remodex 的相关实现。
- 使用 `@larksuite/channel` 扫码创建 PersonalAgent，无需手工配置应用、权限和长连接。

App Server 部分遵循 [OpenAI 官方 Codex App Server 文档](https://developers.openai.com/codex/app-server/)：stdio JSONL、初始化、线程、回合、模型、流式通知和服务端审批请求。

## 最省心的 macOS 使用方式

1. 安装并登录官方 ChatGPT 或 Codex Desktop。
2. 从 Releases 下载 `codex-lark-macos-*.zip`，解压后打开 **Codex Lark.app**。
3. 浏览器会打开一个本机设置页；第一次用手机飞书扫码。
4. 在手机里打开自动创建的个人助手，发送 `/projects`。

设置页只监听随机的 `127.0.0.1` 端口，并使用每次启动随机生成的访问令牌。App Secret 只留在桥接进程中，不会返回给浏览器。

开发构建仅做临时签名，第一次打开可能需要在 Finder 中按住 Control 点击，然后选择“打开”。正式发布前应使用 Developer ID 签名并公证。

## 手机端命令

| 命令 | 作用 |
| --- | --- |
| `/projects` | 显示从 Codex 任务历史识别出的项目 |
| `/project use <路径>` | 为当前飞书会话选择项目 |
| `/tasks` | 显示当前项目的最近任务 |
| `/task use <id>` | 继续已有任务 |
| `/task show <id>` | 查看任务的输入和输出详情 |
| `/task new` | 清除当前任务，下一条消息会新建任务 |
| `/models` | 显示 Desktop 内置核心报告的可用模型 |
| `/model use <模型>` | 为当前飞书会话选择后续使用的模型 |
| `/stop` | 中断当前回合 |
| `/status` | 查看连接、项目、任务和权限状态 |
| `/invite user`、`/remove user` | 管理私聊访问权限 |
| `/invite group`、`/remove group` | 管理群聊访问权限 |
| `/invite all group` | 允许所有群聊（仅 owner/admin） |

审批卡片提供“仅本次允许”“本会话允许”（协议支持时）和“拒绝”。工具不会静默批准权限。

云文档评论按文档权限生效：能访问文档的人，按照飞书自身权限看到并使用对应评论线程。

## “不安装 CLI”到底如何实现

`codex-lark` 会启动一个本机 App Server 进程，但可执行文件直接来自官方桌面应用：

```text
/Applications/ChatGPT.app/Contents/Resources/codex app-server --listen stdio://
```

它不是用户另行安装的 Codex CLI。安装、更新、本地任务存储和 ChatGPT 登录都由 Desktop 管理。当前桌面版本支持时，可选的本机 IPC 跟随器还会把 Desktop 中开始的任务投影给手机，并把手机开始的任务同步回 Desktop。

## 数据和权限

默认数据目录是 `~/.codex-lark/`；开发时可用 `CODEX_LARK_HOME` 隔离配置。

新 profile 使用规范权限字段：

```json
{
  "permissions": {
    "defaultAccess": "workspace",
    "maxAccess": "full"
  }
}
```

旧版 `sandbox` 仅用于迁移兼容，不建议继续配置。扫码者会被解析为应用 owner 和初始管理员，其他访问名单默认关闭。Secret 使用本机密钥库派生密钥加密保存；日志会脱敏凭据、资源 ID、提示内容和本机路径。

共享 Mac 上使用前，请阅读 [docs/PRIVACY.md](docs/PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 开发

需要 macOS 13+、Node.js 22、pnpm；真实集成测试还需要已安装的 ChatGPT/Codex Desktop。

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm package:mac
```

运行开发版扫码面板：

```bash
pnpm build
node dist/cli.cjs desktop
```

维护者也可以使用 CLI 和系统服务：

```bash
codex-lark run
codex-lark start
codex-lark status
codex-lark stop
codex-lark profile export codex --output ./profile.json
codex-lark profile remove codex
codex-lark profile remove codex --purge --yes
codex-lark profile export codex --include-secrets --yes
```

每个 profile 对应独立的 per-profile service，并保留当前 profile 的 lark-cli 目录用于兼容功能。推荐的 Desktop 面板会跳过 lark-cli 安装；聊天、卡片、文件和审批都不依赖它。lark-cli 身份策略只影响可选的 agent 侧飞书工具。

测试分层和发布流程见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 限制

- `0.1.x` 的最终用户平台是 macOS。
- App Server 是主集成；Desktop IPC 是尽力而为的实验能力，可用 `CODEX_LARK_DESKTOP_IPC=0` 关闭。
- Desktop 的私有 IPC 可能随版本变化；App Server 按公开协议实现，但桌面内置版本之间也可能存在差异。
- Mac 必须保持运行，并且能访问 OpenAI 和飞书/Lark 网络。
- 本项目不隶属于 OpenAI、飞书、字节跳动或 Remodex，也未获得这些项目的官方背书。

## 许可证与来源

项目主体使用 MIT。改编自 Lark Channel Bridge 的部分继续遵守 MIT；改编自 Remodex 的 Desktop IPC 模块继续遵守 Apache-2.0。详见 [NOTICE](NOTICE)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)。

欢迎贡献，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
