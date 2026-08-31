# 如何用手机继续 ChatGPT / Codex Desktop 里的 Codex 任务？扫码即用的开源方案

先说结论：可以，而且不用装第二个 Agent、不用填 API Key、不用配公网服务器——一个叫 codex-lark 的开源小工具，让飞书变成 ChatGPT / Codex Desktop 里 Codex 任务的「手机遥控器」，扫码一次就能用。

这里连接的是桌面应用里的 **Codex 项目与任务**，不是普通 ChatGPT 聊天或 ChatGPT Work 会话。

## 为什么会有这个需求

用 ChatGPT / Codex Desktop 跑 Codex 任务的人，大概率遇到过这些场景：

- 人离开电脑，Codex 停下来等你审批一个命令或一次文件修改，只能干等；
- 想用手机继续电脑上的任务，又不想重新描述一遍上下文；
- 同时开好几个项目，手机上切来切去全靠记命令；
- 想发个图、发段语音、发个文件给 Codex，最后只能开远程桌面。

远程桌面太重，在飞书里再造一个 Codex 又太复杂。codex-lark 的思路是：飞书只当「遥控器」，算力和上下文都在电脑上。

## 三步上手

1. 打开电脑上的 ChatGPT 或 Codex Desktop，确认已登录；
2. 在终端运行 `npx -y codex-lark@latest`；
3. 用手机飞书扫描终端里的二维码，收到常用操作卡片后直接开点。

就这三步。不需要安装 Codex CLI，不需要进入飞书开发者后台配置机器人，也不会打开浏览器、不需要公网服务器。配置保存在本地，下次运行同一条命令即可，不用重复扫码。

## 手机上能做什么

- 查看并切换电脑上的项目和任务，继续已有任务或快速新建；
- 发送文字、图片、语音、文件，支持「组合输入」把多条内容作为同一轮提交；
- 实时查看 Codex 的回复和当前执行状态；
- 在手机上允许或拒绝命令执行、文件修改等权限请求；
- 选择模型和推理强度，随时停止正在进行的任务。

项目、任务、模型、常用操作都通过飞书卡片按钮完成，点一下就切换，不用记命令。

## 原理简说

codex-lark 会找到 ChatGPT / Codex Desktop 内置的 Codex app-server 可执行文件，通过 stdio JSON-RPC 与它通信；飞书侧通过官方开放平台建立双向消息通道。你在飞书里发的消息、点的卡片按钮，会被转成 Codex 的输入；Codex 的回复、审批请求、执行状态会实时推回飞书卡片。Desktop 升级后，重启 codex-lark 即可自动识别当前版本。

## 几点提醒

- 电脑需要保持开机，终端需要保持运行；
- 电脑需要能正常访问 OpenAI 和飞书；
- macOS 支持官方 ChatGPT 或 Codex Desktop；Windows 请使用 Microsoft Store 安装的官方 Codex Desktop；
- 数据留在本机，本地配置和临时附件都保存在电脑上，敏感日志会脱敏。

## 开源信息

- GitHub：[github.com/goodyorkye/codex-lark](https://github.com/goodyorkye/codex-lark)
- npm：[codex-lark](https://www.npmjs.com/package/codex-lark)
- MIT 许可证，支持 macOS 和 Windows，需要 Node.js 20.12 及以上版本。

项目不隶属于 OpenAI、飞书或字节跳动。欢迎 star、提 issue、贡献代码。
