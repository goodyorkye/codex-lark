# codex-lark

用手机飞书/Lark 控制 Mac 或 Windows 电脑上的 Codex Desktop 任务：不单独安装 Codex CLI，不开放公网 Web 服务，也不用手工进入飞书开发者后台创建机器人。

[English](README.md) · [配置与本地数据](docs/CONFIGURATION.md) · [架构](docs/ARCHITECTURE.md) · [安全](SECURITY.md) · [路线图](ROADMAP.md)

> 当前状态：早期预览版。macOS 已在本机验证；Windows 已纳入跨平台自动化测试，还需要更多真机验证。Desktop IPC 镜像仍属于实验能力，因为它不是公开文档承诺的稳定接口。

## 能做什么

- 自动找到 macOS `ChatGPT.app`/`Codex.app` 或 Windows 官方 `OpenAI.Codex` Microsoft Store 安装包内置的 Codex 核心，绝不会退回去调用 `PATH` 里的 `codex` 命令。
- 读取 Codex 项目、任务列表、完整会话记录和当前可用模型。
- 从飞书新建任务、继续已有任务，并把文字、推理摘要、工具活动、用量和结果流式显示在卡片中。
- 支持图片和飞书附件；文件下载到电脑的隔离缓存后作为本地输入交给 Codex。
- 把命令执行、文件修改和权限申请显示为带签名的审批按钮。
- 可通过本机 Desktop IPC 同步电脑界面里已经开始的任务；这部分综合了 Remodex 的相关实现。
- 使用 `@larksuite/channel` 扫码创建 PersonalAgent，无需手工配置应用、权限和长连接。

App Server 部分遵循 [OpenAI 官方 Codex App Server 文档](https://developers.openai.com/codex/app-server/)：stdio JSONL、初始化、线程、回合、模型、流式通知和服务端审批请求。

## 最省心的使用方式

需要 Node.js 20.12+ 和已登录的官方桌面应用：macOS 13+ 上的 ChatGPT/Codex Desktop，或从 Microsoft Store 安装的 Windows Codex Desktop。

直接运行，无需安装：

```bash
npx -y codex-lark@latest
```

第一次运行会在终端显示二维码。用飞书扫码后，终端会显示 Desktop 检查、飞书连接和在线状态；保持终端窗口打开即可使用，按 `Ctrl+C` 停止。程序不会打开浏览器，也不会安装或调用独立的 Codex CLI。

经常使用可以先安装，之后用更短的命令启动：

```bash
npm install -g codex-lark
codex-lark
```

当前只提供前台运行模式，关闭终端就会停止桥接；暂不注册系统后台服务。

## 手机端命令

日常使用不必输入命令。每次 Codex 回复结束后都会显示常用操作导航；“最近任务”会跨项目按最后活动时间排列，点击即可切换。选择项目后会直接打开该项目的任务列表。

需要把文字、图片和文件作为同一轮输入时，点击“组合输入”，依次发送全部内容，再点击卡片中的“发送”或直接回复“发送”。收集期间不会触发 Codex；可随时撤销上一项、清空或退出。

| 命令 | 作用 |
| --- | --- |
| `/projects` | 显示从 Codex 任务历史识别出的项目 |
| `/project use <路径>` | 为当前飞书会话选择项目 |
| `/tasks` | 显示当前项目的最近任务 |
| `/task use <id>` | 继续已有任务 |
| `/task show <id>` | 查看任务的输入和输出详情 |
| `/task latest` | 主动获取当前任务最近一轮的输入和输出 |
| `/new` | 在当前项目新建任务 |
| `/models` | 显示 Desktop 内置核心报告的可用模型 |
| `/compose` | 收集多条文字、图片和文件，再作为同一轮发送 |
| `/model select <模型>` | 选择模型并打开该模型的推理强度选项 |
| `/model effort <模型> <强度>` | 为后续消息同时设置模型与推理强度 |
| `/stop` | 中断当前回合 |
| `/status` | 查看当前项目、任务、模型和运行状态 |
| `/help` | 显示手机遥控命令 |

模型与推理强度的选择会覆盖当前任务，并作为后续新建任务的默认值；切换到其他已有任务时，不会覆盖该任务原来使用的模型设置。

`/reset`、`/resume`、`/cd`、`/ws` 是旧桥接模式的重复命令，在 Codex 手机遥控模式中分别由 `/new`、`/tasks`、`/projects` 取代。账号、进程、重连、群聊访问等内部维护命令不在手机遥控界面开放。

审批卡片提供“仅本次允许”“本会话允许”（协议支持时）和“拒绝”。工具不会静默批准权限。

云文档评论按文档权限生效：能访问文档的人，按照飞书自身权限看到并使用对应评论线程。

## “不安装 CLI”到底如何实现

`codex-lark` 会启动一个本机 App Server 进程，但可执行文件直接来自官方桌面应用。在 macOS 上类似：

```text
/Applications/ChatGPT.app/Contents/Resources/codex app-server --listen stdio://
```

Windows 上则会在已安装的 `OpenAI.Codex` 包内解析对应的 `codex.exe`。由于 Windows 可能禁止直接启动 `WindowsApps` 中的内部进程，程序会先把已签名的 Desktop 核心和必要辅助文件复制到 `~/.codex-lark/runtime/` 下的按版本隔离缓存再启动。它们仍然来自已安装的 Desktop，程序不会下载或搜索独立 CLI。两个平台都不会搜索 `PATH`。

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
飞书/Lark App Secret 只保留在本机桥接进程及加密配置中，终端二维码不会输出它。

共享电脑上使用前，请阅读 [docs/PRIVACY.md](docs/PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 开发

需要 Node.js 22 和 pnpm。真实集成测试还需要 macOS 13+ 上的 ChatGPT/Codex Desktop，或 Windows 上的 Microsoft Store Codex Desktop。

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

运行开发版终端桥接：

```bash
pnpm build
node dist/cli.cjs
```

`run` 是兼容写法，效果与无子命令启动相同：

```bash
codex-lark run
codex-lark profile export codex --output ./profile.json
codex-lark profile remove codex
codex-lark profile remove codex --purge --yes
codex-lark profile export codex --include-secrets --yes
```

前台启动默认跳过 lark-cli 安装；聊天、卡片、文件和审批都不依赖 lark-cli。现有 profile 管理命令继续保留，用于导出、切换或安全清理本机配置。

测试分层和发布流程见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 限制

- macOS 已本机验证。Windows 暂属预览支持，还需在真机上完成 Desktop 发现、App Server 启动、扫码、续接任务、审批和 IPC 链路的完整验证。
- App Server 是主集成；Desktop IPC 是尽力而为的实验能力，可用 `CODEX_LARK_DESKTOP_IPC=0` 关闭。
- Desktop 的私有 IPC 可能随版本变化；App Server 按公开协议实现，但桌面内置版本之间也可能存在差异。
- 桥接所在电脑必须保持运行，并且能访问 OpenAI 和飞书/Lark 网络。
- 本项目不隶属于 OpenAI、飞书、字节跳动或 Remodex，也未获得这些项目的官方背书。

## 许可证与来源

项目主体使用 MIT。改编自 Lark Channel Bridge 的部分继续遵守 MIT；改编自 Remodex 的 Desktop IPC 模块继续遵守 Apache-2.0。详见 [NOTICE](NOTICE)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)。

欢迎贡献，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
