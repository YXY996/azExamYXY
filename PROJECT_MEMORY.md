# AZ Exam Coach 项目记忆

更新时间：2026-08-24（Asia/Tokyo）

> 本文件的真实存储位置是 Obsidian 共享库 `projects/az-exam-coach.md`；项目路径为同一文件的硬链接，供 Codex 与 Claude Code/CLI 兼容读取。

## 稳定目标与决策

- 产品用于个人 AZ-104 / AZ-305 备考，默认私有。
- 第一版采用响应式 Next.js PWA，不单独开发原生 App。
- 主链路：PDF 导入 → 候选题抽取 → 人工校对及答案录入 → 批准 → 手机/电脑做题。
- PDF 与题目图片保存在私有存储；Git 不保存源文件和解析后的私人题目。
- 题目必须保留来源页面、内容版本和答案来源；未审核或无答案的题不得发布。
- 导入 Worker 使用 Python；优先原生文本，仅对图片区域或扫描页 OCR。
- 复杂热点、下拉、拖放和案例题先保留原图并进入人工审核，逐步结构化。
- 候选题契约：`contracts/question-candidate.schema.json`。

## 当前 PDF 样本

- 文件：`C:\Users\wisdom\Downloads\AZ-104纯题目1.pdf`
- SHA-256：`5E50111B7D383AAB94D313083C7691BB63863DE8AAF76BC714D775A0881827AE`
- 791 页、610 个题目起点、Topic 1–16，原生文本与大量图片混合。
- PDF 不包含答案或解析；正确答案只能人工录入或从另一个可追溯来源导入。
- Topic 内存在重复题号且内容不同，内部 ID 使用文档哈希、Topic、题号和起始页生成。
- 黄金样本计划：`worker/golden/az104-sample-plan.json`。

## 已实现状态

- 产品、架构、导入、测试、协作和 backlog 文档已完成。
- Python Worker 已能抽取题目边界、普通选项、跨页内容和基础题型，且跳过真正空白分页、保留图片页。
- 已生成首批 50 道本地私有候选题和对应页面图。
- Next.js 原型包含总览、人工校对、答案来源录入、批准和响应式练习界面。
- 已迁移到 Node 24 内置 SQLite：审核草稿有乐观锁，批准创建不可变 revision 和独立 answer key。
- 练习会话固定题目版本，服务端评分并持久化作答事件；刷新后可从同一服务恢复。
- 概览页已支持流式 PDF 上传、100 MiB 实际字节限制、SHA-256 去重和真实后台任务状态。
- 独立 Import Runner 负责 Python 抽取、Schema 校验、Poppler 页面渲染及 SQLite 幂等提交。
- 证据页已按 `document_id` 隔离，旧的全局 page API 已移除。
- 概览页显示进行中练习、错题数量和最近三次练习摘要。
- 当前为固定本地单用户模式；正式跨公网/多设备版本尚未接登录、PostgreSQL 和对象存储。
- 首批 50 题已完成 Codex 初审、Microsoft Learn 来源核对和 Claude Code 单题复核；36 题达到高置信度门禁并发布为不可变练习版本，14 题保留待复核。
- 每道已发布题都有中文答案解析与官方来源；批准门禁现在强制要求解析，练习提交后会显示解析。
- 14 道待复核题包括歧义/过时题、图片拖放或热点题、抽取重复选项题；不得为了凑数量强行发布。
- 首批合并复核记录：`docs/answer-research/claude-verification.json`。一次来源格式修复保留了 14 个旧审计 revision；当前指针均指向来源完整的新版本。
- 已完成全量导入：610 道候选题、610 个唯一题目 ID、791/791 页证据图；此前 50 题只是原型上限，并非 PDF 总题量。
- 第 51–100 题也已完成双重校对，其中 30 题批准、20 题待复核。当前总计 66 道可练习题、544 道未批准候选题。
- 第 101–400 题已完成 Codex 初审、逐页证据核对、Microsoft Learn 来源研究和中文解析草稿；尚未完成 Claude 双重校对，因此未发布。第 151 题有一次真实 Claude 返回，其余不得标记为 Claude 已复核。
- 第 51–100 题合并复核记录：`docs/answer-research/claude-verification-051-100.json`。
- 同一 PDF 从样本导入扩展为全量导入时，Runner 现在会幂等补齐已有 document 页面目录，而不是因目录已存在跳过；第 791 页 API 已实测 200。
- 零作答的活动练习会话会自动补入新批准题；当前活动会话已从 36 题扩充到 66 题。一旦产生答案事件，题目版本和集合继续冻结。
- 已增加通用“AI 工作台”：只读扫描本机 `.codex/.chatgpt-projects` 下各项目的队列状态、Claude 运行元数据和持久工作记录，统一显示 Codex/Claude/Worker 进度；手动刷新不调用模型、不消耗 token。完成账本优先于残留运行元数据，超过一小时的运行状态标记为过期，API 不返回项目绝对路径。

## Claude Code 与 OmniRoute

- 不直接调用裸 `claude.ps1`，否则会绕过 OmniRoute 环境注入。
- 通用入口：`C:\Users\wisdom\Documents\Codex\2026-08-05\ban\outputs\Start-AI-Code.ps1`。
- Claude 链路：`Start-AI-Code.ps1` → `Test-And-Start-Claude-OmniRoute.ps1` → `Start-Claude-OmniRoute.ps1`。
- 已验证 `oc/mimo-v2.5-free` 可通过 OmniRoute 使用。
- 启动器使用 `--bare`；委派任务时必须在提示中显式要求读取本文件与相关项目文件。
- 旧启动器会在每次启动时杀掉其他 alias proxy，造成并行 Claude 任务互相 `ConnectionRefused`；现已改成按模型固定端口、互斥启动并复用健康代理。
- `oc/mimo-v2.5-free` 对多题长提示响应很慢；答案复核应采用单题串行调用。首批 50 题的第二轮复核按此方式完成。
- 2026-08-11 后续复核时，多个免费模型出现无正文或探针超时；这属于模型池可用性问题，不是登录状态。恢复时必须先通过 Claude Code same-path `PROBE_OK` 探针，再开始单题队列。
- 2026-08-13 起采用低 Codex token 的指挥模式：Claude Code 承担主要研究/复核执行，Codex 只负责任务拆分、进度检查、门禁验收、合并与发布。
- Claude CLI 的持久工作账本为 `CLAUDE_WORKLOG.md`；每次提示必须显式读取 `PROJECT_MEMORY.md` 与该账本，并在完成或阻塞后写回任务状态、模型、范围、产物和校验摘要。
- 路由分工：OmniRoute 队列保留第 101–400 题的既有初审复核；9router Claude Code 只接手第 401–610 题的新内容，按不重叠小批次执行，避免重复 token 消耗。
- 2026-08-13 诊断修正：`-Gateway 9router` 下发 401–405 时，首选 deepseek/mimo 明确遭遇 429，但后备 `oc/nemotron-3.5-lightning-free` 多次成功并持续驱动 Claude 工具调用。Claude `--print` 只在整体完成后输出，外层静默不等于卡死；此前约 5 分钟中止是 Codex 等待门限过短。后续允许至少 30 分钟，并依据网关活动和产物判断存活。
- 2026-08-13 same-path 快速工具探针通过，但首个真实批次 `CC-AZ104-VERIFY-101-117` 经 unified gateway auto 路由约 5 分钟无正文且无产物，已安全停止并记为 blocked；快速探针通过不能替代真实任务可用性验证。
- 2026-08-14 修复网关配置：`Start-Gateway-Stack.ps1` 启动 9router 前必须把 `DATA_DIR` 切换为 `%APPDATA%\9router`，否则会误读 OmniRoute 数据库并产生 401。已验证 9router 独立数据库和活动 Key 请求返回 200。
- Claude 非交互文件任务由 `scripts/run-claude-task.ps1` 启动，允许启动网关，并传入 `--dangerously-skip-permissions --max-turns 60`；所有范围仍由任务单和 `sources/` 只读规则限制。
- 第 401–405 题已由 9router Claude Code 完成初审返工，`batch-401-405.json` 已通过题号、question_id、option ID、解析和来源契约校验；404–405 为无稳定 option ID 的交互题，保持阻断。下一批从 406 开始。
- 2026-08-14 启用无人值守单题队列 `scripts/run-claude-answer-queue.ps1`：本地程序先按 `candidates[sequence-1]` 生成不可歧义的私有题目快照，Claude 只研究该快照；每题通过 question_id、option ID、解析和来源自动验收后才进入下一题。队列状态保存在 `data/private/claude-answer-queue/state.json`，失败即停止，不跨题扩散。
- 无人值守队列提示会直接注入期望 question_id 和允许的 option UUID；普通选择题空答案也属于门禁失败。第 407 题首次输出因 question_id 错配且答案数组为空被自动拦截，恢复时从 407 重试。
- 2026-08-14 token 效率调整：第 415 题前的单题队列暂停；从 415 起改用 3 题微批次 `scripts/run-claude-microbatch-queue.ps1`，共享一次初始化与来源研究。Claude 不再逐题读取不断增长的 `CLAUDE_WORKLOG.md`，外部队列将每批真实执行记录追加到私有 `claude-work-records.jsonl`；仍必须读取 `PROJECT_MEMORY.md` 并通过完整题目/答案契约门禁。
- 答案研究的跨会话共享知识库位于 `docs/answer-research/memory/`，按 Topic 拆分。只保存可复用 Azure 概念、现行/历史行为差异、退役日期、歧义提示和 Microsoft Learn URL；严禁保存 PDF 题干、题号、选项映射或正确答案。Claude 微批次只读取和更新相关 Topic 文件，以降低重复研究和 token。
- 微批次验收后由 `scripts/update-research-source-memory.cjs` 兜底把已验证的 Microsoft Learn 标题与 URL 去重写入相关 Topic 的 Obsidian 研究记忆；Claude 负责补充可复用概念与历史/现行差异。最终答案文件作为研究记忆更新后的完成标记。
- 2026-08-15 对不支持视觉的 OmniRoute 采用“本地查看证据页 -> 私有文字证据 -> Claude 纯文本核对”恢复模式。第 418–420 题已按此方式通过完整契约验收，Topic 5 Obsidian 研究记忆已补充 NIC 区域约束、公共 DNS 委派和 Network Watcher 工具映射；私有证据摘要不进入共享记忆。
- 2026-08-15 第 421–423 批首次运行并非 429，而是 Claude Code 达到启动脚本遗留的 30 轮上限；`run-claude-task.ps1` 已恢复为 60 轮，微批次提示预算调整为 55 轮后原批重试。
- 2026-08-15 第 421–429 题已通过微批次自动契约验收。第 430–432 批首次因同时读取页面图片触发上下文反复压缩而停止；队列现规定文本抽取完整时不读 PNG，仅在图片依赖/抽取损坏时逐页单独查看，随后从 430 重试。
- 2026-08-15 第 430–435 题已通过自动契约验收。第 436–438 批首次 Claude 退出码为 0 且完成研究记忆更新，但在写最终 JSON 前提前收尾；提示已增加“文件存在且验证器退出 0 才算完成”的硬约束，并从 436 重试。
- 2026-08-15 第 436–438 题已通过 OmniRoute 纯文本恢复和完整契约验收；图片依赖由本地视觉转成私有文字证据，未写入共享记忆。下一批从 439 开始。
- 2026-08-16 第 439–441 题已通过自动验收。442–444 的三题提示被当前免费模型拒绝为过长，队列临时改为单题处理 442–444，完成后恢复三题批次。
- 2026-08-16 第 442–444 题已按单题模式全部通过契约验收；从 445 起恢复三题微批次。网站开发服务已重新启动并在 `127.0.0.1:3000` 返回 200。
- 2026-08-16 答案校对固定采用 text-first：题干和选项完整的普通单选、多选、判断题禁止读取 PNG 或 OCR；仅缺失表格/截图、热点、拖放或抽取损坏时逐页读取图片，不能为重复确认完整文本而用视觉模型。
- 2026-08-16 第 445–447 题已在 text-first 规则下通过契约验收，队列自动进入 448–450。
- 2026-08-16 第 448–453 题已通过契约验收。454–456 三题批次达到 60 轮上限，临时拆为单题处理，完成后从 457 恢复三题微批次。
- 2026-08-16 第 454 题已通过本地视觉转私有文本、9router 纯文本恢复和契约验收；OmniRoute 本次在模型调用前挂起，因此未采用其结果。队列继续单题处理 455–456。
- 2026-08-17 第 455 题首次运行在 Claude 稳定代理接入后无模型输出；已用归属校验脚本仅重启 21381 Claude alias proxy，并从 455 重试，网站服务同时恢复为 HTTP 200。
- 2026-08-23 用户停止 Claude/双重核对方案，要求 Codex 直接按 PDF 已标记答案全量导入。旧 `AZ-104纯题目1.pdf` 经再次核查仍无普通题选中标记、答案键或表单字段；610 道题目已全量导入，但直接答案发布等待用户提供实际带标记答案的 PDF，禁止把未选中控件或默认蓝色界面元素误判为答案。
- 2026-08-23 已接入 `AZ-104带讨论1.pdf`（SHA-256 `28bb8ad46d1ad7e4f99e73024f041fb4f35d10c08992b1de7bbcfe0126feb9f7`，2354 页）。按 Topic、题号与规范化题干将其 610 题与现有题库逐题匹配，匹配 610/610、无多余或遗漏。
- 带讨论版 PDF 的普通文本答案已直接导入 400 题；210 道热点、拖放、矩阵等图片交互题保留纯题目版原页，并生成私有 PDF 答案页图片，练习时采用“先作答、再显示 PDF 标记答案、自评”的模式。答案来源均记录 PDF 指纹和页码，未进行 Claude 或外部正确性核对。
- 当前数据库 610/610 题已批准，624 个不可变 revision/answer key（含历史版本）。导入前分别保存普通题与复杂题 SQLite 备份。已新建包含全部 610 题的活动练习会话，旧 4/66 作答历史保留为已完成会话。
- 网站新增 `image_interaction` 运行题型、私有答案图片 API 和“开始全量新练习”入口；生产构建、14+2 项领域测试、610 题数据库一致性与答案图片 200/private/no-store 验收通过。
- 2026-08-23 练习模式改为每组从当前批准题库随机抽取 20 题；活动会话仍固定 revision，完成或主动开始新组后才重新抽样。作答事件新增单题耗时，练习汇总和最近记录显示累计用时与正确率。
- 错题本由“服务端判错的题目”与“用户手动标记的题目”取并集；练习页可随时添加/取消手动标记，概览可随机抽取最多 20 道错题练习。旧 610 题活动会话已归档，新活动组为随机 20 题且 0/20 未作答。
- 2026-08-24 增加单用户身份认证：首次注册创建唯一管理员账号，密码使用 scrypt+随机盐保存，之后注册关闭；登录签发 30 天 HttpOnly/SameSite=Strict 签名 Cookie，全站、PDF 与业务 API 均受保护，只有 `/api/health` 匿名开放。生产环境要求至少 32 位 `APP_SESSION_SECRET` 与 HTTPS。
- GitHub Actions 已加入提交检查、测试/Lint/生产构建、GHCR `latest` 容器镜像发布和每 30 分钟健康检查。费用决策：只使用标准 GitHub-hosted Runner 免费额度或自托管 Runner，不启用 larger runner/付费 Actions；私有 GitHub Free 按当前官方额度每月 2000 分钟，30 分钟一次监控约占 1440 分钟。GitHub Actions 不作为常驻主机；运行容器需要外部平台和持久卷 `/app/data/private`。当前 Git 仓库没有 remote，且尚未提供运行平台授权，因此只能完成本地提交与部署制品，不能远程推送或启动云服务。
- 2026-08-14 项目记忆已统一接入 Obsidian Vault `C:\Users\wisdom\Documents\Obsidian\AI-Memory-Hub`：项目长期记忆存放在 `projects/az-exam-coach.md`，Claude 执行账本存放在 `audit/az-exam-coach-claude-worklog.md`，Azure 研究记忆存放在 `AZ-104/research-memory/`。项目原路径通过硬链接或目录联接指向 Vault，避免双份真相。

## 团队工作规则

- 用户是 Product Owner；Codex 负责技术设计、拆分、集成和验收。
- 用户授权时可把独立任务分配给不同 Agent；不要让多个 Agent 同时编辑同一文件。
- Claude Code 适合边界清晰的实现任务或独立复核。
- 每项功能需要验收标准、自动测试、代码审查和真实页面验证。
- PDF 流水线变更必须通过固定哈希的黄金样本回归。

## 下一步优先级

1. 实际做题验收 210 道图片交互题的答案页可读性，并按需要从整页答案图升级为区域裁剪。
2. 增加按 Topic 筛选和服务端按题分页加载；随机 20 题、错题本、正确率与耗时记录已完成。
3. 增加登录与 owner 级授权映射，为手机跨公网访问和多用户隔离做准备。
4. 增加私有对象存储并迁移 PostgreSQL，替换本机固定 owner。
5. 逐步把高频热点、拖放和矩阵题从图片自评结构化为可自动评分交互。

## Architecture

### AZ Exam Coach memory unified in Obsidian

- source: codex
- status: confirmed
- date: 2026-08-14
- fingerprint: ddcd01c6df57b5af4ad5

The canonical shared memory for AZ Exam Coach is in AI-Memory-Hub. projects/az-exam-coach.md stores durable project memory, audit/az-exam-coach-claude-worklog.md stores Claude CLI work records, and AZ-104/research-memory stores reusable topic research. Project paths link to the same source. Private PDFs, question text, answers, databases, and transient logs remain outside shared memory.
