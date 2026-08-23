# AZ Exam Coach

一个面向 AZ-104 / AZ-305 备考的私人做题网站。当前原型已经能把真实 PDF 抽取为待校对题目，并在电脑和手机上完成“对照原页—修正题目—录入答案—批准—练习”的完整闭环。

## 当前可用能力

- 识别 PDF 中的 Topic、Question 编号、题干、选项和跨页题目。
- 可以从概览页上传 PDF，按真实阶段查看后台导入任务，并用 SHA-256 防止重复导入。
- PDF、候选结果和证据页按文档隔离存储，第二本 PDF 不会覆盖第一本的页图。
- 题号重复时仍生成不同内部 ID，不会覆盖题目。
- 原始 PDF 与生成的页面图保留在本机私有目录，不进入 Git。
- 校对界面左右对照原始页面和结构化内容。
- 审核草稿与乐观锁保存在本机 SQLite，刷新或换浏览器不会丢失。
- 没有人工确认答案及答案来源的题不能发布到练习区。
- 批准会生成不可变题目版本；练习会话固定引用该版本。
- 作答由服务端评分并保存，响应式练习界面支持电脑和手机尺寸。
- 每组随机 20 题，记录正确率、作答时间，并支持错题本。
- 可按 AZ-104/AZ-305 与一个或多个知识点筛选练习；符合条件不足 20 题时使用全部匹配题目。
- 首次访问创建唯一管理员账号；之后必须登录才能访问题库、PDF 和业务 API。

样本 PDF 没有答案与解析。系统不会猜测答案；必须由你录入，或者以后导入带可信来源的答案文件。

## 本地运行

首次准备样本数据：

```powershell
.\scripts\prepare-local-sample.ps1 -PdfPath "D:\path\to\AZ-104.pdf"
```

启动网站：

```powershell
cd apps\web
pnpm install
pnpm dev
```

浏览器打开 `http://127.0.0.1:3000`。审核、版本和练习进度保存在 `apps/web/data/private/` 下的本机 SQLite；进入云端版本后可迁移到 PostgreSQL。

首次打开 `/register` 创建管理员账号。生产环境必须配置至少 32 位的随机会话密钥：

```powershell
$env:APP_SESSION_SECRET = "请替换为至少32位的随机字符串"
pnpm start
```

生产环境必须启用 HTTPS。系统只允许注册第一个账号；创建成功后注册自动关闭。

## GitHub Actions 与部署

- `.github/workflows/ci.yml`：每次提交运行测试、Lint、生产构建，并将容器镜像发布到 `ghcr.io/<owner>/az-exam-coach`。
- `.github/workflows/uptime.yml`：每 30 分钟访问一次 `/api/health`。部署后在仓库 **Settings → Secrets and variables → Actions → Variables** 设置 `SERVICE_URL`。私有 GitHub Free 仓库按每次至少 1 分钟估算约占 1440 分钟/月，给提交构建预留免费额度。
- GitHub Actions 负责检查、制作镜像和触发部署，不提供常驻网站进程。容器必须运行在 Azure Container Apps、VPS、NAS 或自托管 Runner 所在机器。
- 本项目只使用标准 GitHub-hosted Runner 的免费额度或自托管 Runner；不使用 larger runner 或付费 Actions。私有 GitHub Free 仓库当前包含每月 2000 分钟，公开仓库的标准 Runner 和自托管 Runner免费。
- 容器的 `/app/data/private` 必须挂载持久卷；该目录包含 SQLite、题目页图和答案图片，不进入 Git 或容器镜像。
- 可选的本机部署工作流只在受保护 `master` 的 CI 成功后运行，或由仓库所有者手动触发。它调用仓库外的私有控制器；Fork 和 Pull Request 不会触发本机 Runner，也无法访问本机 PDF、数据库或会话密钥。

容器运行示例：

```bash
docker run -d --name az-exam-coach --restart unless-stopped \
  -p 3000:3000 \
  -e APP_SESSION_SECRET="长随机密钥" \
  -v /opt/az-exam-coach/data:/app/data/private \
  ghcr.io/OWNER/az-exam-coach:latest
```

公开仓库只保存代码和部署契约。生产数据、Cloudflare Tunnel 状态、会话密钥及本机部署控制器均保存在运行主机，不能提交到 Git。

## 质量检查

```powershell
python -m unittest discover -s worker\tests -v
cd apps\web
pnpm lint
pnpm build
```

带答案、解析和知识点标签的 Markdown 题库可用幂等导入器加入本机私有数据库：

```powershell
node scripts\import-markdown-question-banks.mjs D:\path\bank-v1.md D:\path\bank-v2.md
node scripts\verify-markdown-import.mjs
```

## 项目资料

- [PDF 样本分析报告](docs/2026-08-11_pdf-sample-analysis-report.md)
- [产品蓝图](docs/product-blueprint.md)
- [系统架构](docs/architecture.md)
- [PDF 导入与数据契约](docs/pdf-ingestion.md)
- [网页 PDF 上传与后台任务](docs/pdf-upload-and-import-jobs.md)
- [测试与质量门禁](docs/test-strategy.md)
- [本地持久化、题目版本与练习记录](docs/persistence-and-practice.md)
- [团队与 Agent 工作流](docs/team-workflow.md)
- [MVP 实施清单](docs/mvp-backlog.md)
- [候选题 JSON Schema](contracts/question-candidate.schema.json)
- [黄金样本计划](worker/golden/az104-sample-plan.json)

## 内容边界

所有上传内容默认仅供上传者私人学习，不公开、不索引、不分享。使用者应确认对上传资料拥有合法使用权；本项目不宣称题库来自 Microsoft 官方。
