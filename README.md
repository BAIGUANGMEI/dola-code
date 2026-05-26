# Dola Code

一个面向 BytePlus ModelArk / 火山引擎方舟 Dola 模型的轻量终端 coding agent 原型。模型可以读取/修改代码、搜索文件、执行命令，并根据工具结果继续推理下一步。

## 快速开始

```powershell
npm start
```

首次启动时会自动进入配置引导。配置可以保存到全局，也可以保存到项目本地：

```text
~/.dola-code/config.json
```

```text
.dola-code/config.json
```

项目配置会覆盖全局配置。配置文件会保存 profile、Base URL、模型名、API Key、地区、调用类型、context window 和 max output tokens。项目本地的 `.dola-code/config.json` 已经被 `.gitignore` 忽略，不会默认提交到仓库。

也可以主动重新配置：

```powershell
npm start -- --init
```

或在交互中运行：

```text
> /init
```

## 配置引导

配置文件使用 profile 组织，格式类似：

```json
{
  "schemaVersion": 2,
  "activeProfile": "default",
  "profiles": {
    "default": {
      "baseUrl": "https://ark.ap-southeast.bytepluses.com/api/v3",
      "model": "seed-2-0-code-preview-260328",
      "apiKey": "...",
      "contextWindow": 256000,
      "maxOutputTokens": 4096
    }
  }
}
```

解析顺序是：默认值 < `~/.dola-code/config.json` < 项目 `.dola-code/config.json` < 启动参数覆盖。

引导会提供这些 ModelArk OpenAI-compatible 入口预设：

- BytePlus International / AP Southeast / 普通 Model API: `https://ark.ap-southeast.bytepluses.com/api/v3`
- BytePlus International / EU West / 普通 Model API: `https://ark.eu-west.bytepluses.com/api/v3`
- BytePlus International / AP Southeast / Coding Plan: `https://ark.ap-southeast.bytepluses.com/api/coding/v3`
- 火山引擎中国区 / 北京 / 普通 Model API: `https://ark.cn-beijing.volces.com/api/v3`
- 火山引擎中国区 / 北京 / Coding Plan: `https://ark.cn-beijing.volces.com/api/coding/v3`
- Custom: 自定义 OpenAI-compatible Base URL

当前 Dola 模型预设：

- Code: `seed-2-0-code-preview-260328`
- Pro: `seed-2-0-pro-260328`
- Lite: `seed-2-0-pro-260328`

没有 `ark-code-latest` 预设。ModelArk 控制台里的模型和 endpoint 名称可能随账号、地区和开通能力变化，所以引导永远保留 `Custom model` 选项。控制台里复制到的模型名或 endpoint id 可以直接填进去。

## 命令

进入交互后直接描述任务即可：

```text
> 帮我阅读这个项目并修复测试失败
```

内置本地命令：

- `/init`: 重新运行配置引导并保存到 `.dola-code/config.json`
- `/config`: 查看当前模型、Base URL、工作目录、调用类型和已隐藏的 API Key 状态
- `/context`: 查看当前会话消息数量、上下文 token 估算、配置窗口和占比
- `/doctor`: 发送一个不带工具的最小请求，用来确认 API 连通性
- `/repo-map`: 重建并查看当前项目的文件图谱和符号图谱
- `/memory`: 查看长任务阶段性记忆
- `/profile`: 查看当前 active profile
- `/profile list`: 查看全局和项目可用 profile
- `/profile use <name>`: 切换 active profile，并持久化到当前配置层
- `/limits`: 查看当前 context window 和 max output tokens
- `/status`: 一次性查看配置、上下文和当前会话累计 usage
- `/theme`: 查看当前终端输出模式
- `/changes [id]`: 查看本会话已追踪的文件变更；带 id 时展开该变更的 diff
- `/undo [id]`: 回退最近一次活动变更；带 id 时回退指定变更；确认要覆盖当前文件漂移时可加 `--force`
- `/turn-log <id>`: 展开折叠后的 Model Notes 和 Turn Summary
- `/tool-log <id>`: 展开折叠后的工具调用详细日志
- `/tools`: 列出当前可用的 workspace 工具
- `/usage`: 查看当前会话累计 token usage 和耗时
- `/model <name>`: 切换模型，并持久化到当前 active profile
- `/cwd`: 查看工作目录
- `/compact`: 保留 system prompt 和最近 20 条消息，手动裁剪上下文
- `/clear`: 清空当前对话上下文
- `/help`: 查看帮助
- `/exit`: 退出

Prompt 快捷方式：

- `@path`: 把 workspace 内的文件内容或目录列表附加到下一条 prompt
- `!command`: 直接运行 shell 命令，仍然走确认机制

有副作用的工具默认需要确认，例如写文件和执行 shell 命令。如果你要让 agent 自动执行，可以用：

```powershell
npm start -- --yes
```

调试请求时可以打开 debug 输出：

```powershell
npm start -- --debug
```

输出模式：

```powershell
npm start -- --profile default
npm start -- --context-window 256000
npm start -- --max-output-tokens 4096
npm start -- --compact-output
npm start -- --verbose
npm start -- --no-stream
```

## 当前能力

- `list_files`: 列出目录内容
- `read_file`: 读取文件片段
- `search_files`: 用 `rg` 搜索文本
- `write_file`: 写入或创建文件
- `edit_file`: 基于精确字符串替换文件内容
- `run_command`: 执行 shell 命令

文件写入和编辑会在当前 CLI 会话内记录为可审计变更。可以用 `/changes` 查看变更列表，用 `/changes <id>` 查看单个 unified diff，用 `/undo` 或 `/undo <id>` 回退。回退前会检查当前文件内容是否仍然等于 agent 写入后的快照；如果文件已经被其他操作改过，会拒绝覆盖并提示冲突。确认要覆盖当前文件漂移时，可以使用 `/undo <id> --force`。

## 长任务上下文

CLI 会在每轮任务前自动构造轻量上下文：

- repo map：当前项目文件列表
- symbol map：从常见源码文件中提取的函数、类、导出符号和 Markdown 标题
- relevant files：根据用户任务关键词自动挑选的相关文件片段
- stage memory：长任务中的阶段性任务、工具结果和回答摘要

当对话变长时，CLI 会自动生成 compact summary，并保留最近消息，减少上下文膨胀。工具结果写回模型上下文时也会做摘要压缩；完整工具结果仍可用 `/tool-log <id>` 查看。

## 终端输出

CLI 会在每次模型请求时显示：

- 输入框上方 sticky 状态条：模型、服务模式、权限模式、消息数量、上下文估算和会话累计 token
- sticky 状态条会显示 active profile，并以 `ctx~ 当前估算/配置窗口` 展示上下文窗口
- User Request：本轮用户请求摘要
- 当前 agent step
- 当前消息数量
- 上下文 token 估算
- 模型请求耗时和 token usage 的折叠摘要
- 工具调用默认折叠，只显示状态、耗时和 `/tool-log <id>`
- 工具输出默认折叠，使用 `/tool-log <id>` 展开详细 JSON
- 写文件和编辑文件会显示 unified diff，并记录到 `/changes`
- 模型回答支持流式 Markdown 渲染：标题、列表、任务列表、引用、代码块、inline code、链接和表格会转换成终端友好格式
- 如果网关不支持流式输出，可用 `--no-stream` 关闭
- 模型显式返回的可见 reasoning 字段会在思考过程中流式显示，结束后折叠为 Model Notes
- Turn Summary 默认折叠，使用 `/turn-log <id>` 展开
- 本轮最底部默认保持为 Answer

这些能力覆盖了 coding agent CLI 的常见交互：slash commands、状态/usage、工具调用时间线、文件引用和 shell 快捷命令。

终端颜色和样式使用 `picocolors`，同时支持 `NO_COLOR=1` 禁用颜色。

注意：真实 TTY 中会尝试把已流式输出的 Model Notes 回收成折叠摘要；在管道或日志输出中无法移动光标，只会追加折叠提示。

输入提示符是 `dola >`，每次等待输入前都会刷新一行 usage/status，保持在输入框上方。

注意：这里不会展示隐藏推理链。只会展示模型响应里显式返回的 `reasoning_content` / `reasoning` / `thinking` 字段，或者普通回答中的可观察计划和状态。

## 项目结构

```text
bin/
  dola-code.js        CLI 入口，只负责启动
src/
  agent.js            agent 主循环、工具调用回写和上下文裁剪
  config.js           命令行参数和本地 JSON 配置加载
  constants.js        默认模型、Base URL、版本号和限制参数
  doctor.js           /doctor 连通性检查
  prompts.js          system prompt
  client/
    modelark.js       BytePlus ModelArk OpenAI-compatible 客户端
  cli/
    help.js           banner 和帮助文本
    session.js        交互式 CLI 会话和内置命令
  session/
    changes.js        本会话文件变更追踪、diff 查看和 undo
    memory.js         compact summary 和长任务阶段性记忆
    repo-map.js       repo map、symbol map 和相关文件选择
    stats.js          token usage 和耗时统计
    tool-summary.js   多轮工具结果摘要压缩
  settings/
    presets.js        国内外普通 API / Coding Plan / 模型预设
    store.js          全局/项目 config、profile 合并和持久化
    wizard.js         配置引导流程
  tools/
    schema.js         提供给模型的工具 JSON schema
    index.js          工具路由
    workspace.js      文件、搜索和命令执行工具实现
  utils/
    text.js           截断、密钥脱敏等文本工具
    tokens.js         token 粗略估算和 usage 格式化
  tui/
    markdown.js       流式 Markdown 终端渲染
    output.js         终端输出、颜色、状态和 usage 展示
```

## 排查

如果请求失败，先进入 CLI 后运行：

```text
> /config
> /doctor
```

`/doctor` 只发送最小 chat completion 请求，不会带工具定义。这样可以区分“模型/API 配置问题”和“agent 工具调用问题”。

如果返回 `InvalidSubscription`，通常说明你选择了 Coding Plan 地址，但账号没有有效 Coding Plan 订阅；普通模型调用请使用 `/api/v3`。

## 参考

- BytePlus ModelArk 文档: https://docs.byteplus.com/zh-CN/docs/ModelArk/1399008
