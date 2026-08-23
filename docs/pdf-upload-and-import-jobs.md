# 网页 PDF 上传与后台导入任务

## 范围

第三阶段允许在概览页选择 PDF、考试类型和导入范围，并创建真实后台任务。上传、解析、渲染和提交均在本机完成，不会把 PDF 发送到外部服务。

当前仍是固定本地单用户模式。不要把开发服务器直接暴露到公网；增加登录和用户级授权后才能用于公网或多用户环境。

## 上传边界

- 请求体直接使用 `application/pdf`，不使用会整体缓冲的 multipart 表单。
- 服务端按数据块写入随机 `.part` 文件，同时计算 SHA-256 和实际字节数。
- 无论 `Content-Length` 是否可信，实际数据超过 100 MiB 都立即拒绝。
- 文件名只作为清洗后的展示文本，不参与存储路径。
- PDF 必须包含 `%PDF-` 文件头；损坏、加密或超过 2,000 页的文件由 Worker 拒绝。
- 完成上传后按 SHA-256 保存到内容寻址 blob；同内容、同配置返回原任务。

## 后台进程

Next.js 请求只负责落盘和创建 `import_jobs`。独立 Node Runner 使用固定可执行文件和参数数组调用 Python Worker 与 Poppler，`shell=false`，不会把文件名拼进命令。

状态机：

```text
queued → validating → extracting → rendering → committing → review_ready
                                                        ↘ failed
```

任务有租约和最多三次尝试。页面关闭不会终止已经启动的 Runner；读取任务列表时也会重新唤醒排队或租约过期的任务。

## 结果校验与提交

- Python 输出先写临时文件，再原子替换正式候选 JSON。
- 每个候选题通过 JSON Schema 校验。
- Runner 检查源 SHA-256、页数、候选数量和来源页范围。
- 页图逐张检查 PNG 文件头与非空大小。
- 题目和草稿在短 SQLite 事务中幂等写入；PDF 解析和页面渲染不占用数据库事务。

## 文档隔离

证据页位于：

```text
data/private/documents/<document_id>/pages/page-0001.png
```

读取接口为 `/api/documents/<documentId>/pages/<page>`。接口先检查本地 owner 是否拥有该文档，再从固定文档目录读取，响应使用 `private, no-store` 和 `nosniff`。旧的全局 `/api/source-page/<page>` 已移除。

## 当前限制

- 解析进度目前按可靠阶段报告；Worker 尚未输出逐页 JSONL 进度。
- 只支持单 Runner 并发，避免个人电脑同时处理多本大 PDF。
- 复杂 HOTSPOT、拖放和下拉题仍进入人工审核。
- 当前物理 blob 与文档 ID 按哈希去重；接入多用户前必须增加 owner 级授权映射，不能直接沿用全局唯一约束。
