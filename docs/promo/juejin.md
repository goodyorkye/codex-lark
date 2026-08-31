# 用飞书继续 ChatGPT / Codex Desktop 里的 Codex 任务：扫码即用，不装 CLI、不填 API Key

> 开源项目 codex-lark：让飞书成为 ChatGPT / Codex Desktop 里 Codex 任务的轻量手机遥控器。

## 痛点

ChatGPT / Codex Desktop 里的 Codex 在电脑上跑任务时，你大概率遇到过这些情况：

- 人不在电脑前，Codex 停下来等你审批一个命令、一次文件修改，只能干等；
- 想用手机继续电脑上的任务，又不想装第二个 Agent、重新描述一遍上下文；
- 同时开好几个项目，手机上切来切去全靠记命令；
- 发个图、发段语音、发个文件给 Codex，最后只能开远程桌面。

## 方案：让飞书变成手机遥控器

[codex-lark](https://github.com/goodyorkye/codex-lark) 做的事情很简单：**把 ChatGPT 或 Codex Desktop 里已有的 Codex 项目和任务，带到飞书里**。手机和电脑继续的是同一项工作，不另起炉灶。

这里连接的是桌面应用里的 **Codex 项目与任务**，不是普通 ChatGPT 聊天或 ChatGPT Work 会话。

最核心的卖点：

- **不用装 Codex CLI，不用填 OpenAI API Key**；
- **不用进飞书开发者后台配机器人**——扫码一次，机器人自动创建并绑定；
- **一个机器人管整台电脑上多个项目和多个任务**；
- **卡片式按钮操作**：最近任务、项目、模型、推理强度、组合输入，点一下就切换，不用记命令；
- 支持发文字、图片、语音、文件，还支持“组合输入”把多条内容作为同一轮提交；
- 权限请求（命令执行、文件修改等）直接在手机上允许或拒绝；
- 数据留在本机，敏感日志脱敏。

## 三步开始使用

1. 打开电脑上的 ChatGPT 或 Codex Desktop，确认已登录；
2. 在终端运行 `npx -y codex-lark@latest`；
3. 用手机飞书扫描终端里的二维码，收到常用操作卡片后直接开点。

没有公网服务器、不弹浏览器、不需要重复扫码，配置保存在本地。

## 工作原理（简版）

`codex-lark` 会找到 ChatGPT / Codex Desktop 内置的 Codex app-server 可执行文件，通过 stdio JSON-RPC 与它通信；飞书侧通过官方开放平台建立双向消息通道。你在飞书里发的消息、点的卡片按钮，会被转成 Codex 的输入；Codex 的回复、审批请求、执行状态，会实时推回飞书卡片。Desktop 升级后，重启 `codex-lark` 即可自动识别当前版本。

## 隐私与安全

本地配置和临时附件都保存在电脑上；日志中的敏感信息会脱敏。项目不隶属于 OpenAI、飞书或字节跳动，也没有任何官方背书——它只是把两者“桥”起来。

## 开源信息

- GitHub：[github.com/goodyorkye/codex-lark](https://github.com/goodyorkye/codex-lark)
- npm：[codex-lark](https://www.npmjs.com/package/codex-lark)
- MIT 许可证，支持 macOS 和 Windows，需要 Node.js 20.12+
- macOS 支持官方 ChatGPT 或 Codex Desktop；Windows 支持 Microsoft Store 版 Codex Desktop

欢迎 star、提 issue、贡献代码。也感谢 [Lark Channel Bridge](https://github.com/zarazhangrui/lark-coding-agent-bridge) 和 [Remodex](https://github.com/Emanuele-web04/remodex) 两个参考项目。
