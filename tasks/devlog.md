# Devlog

## 2026-03-13 — Stage 0 框架搭建

**Why**: 主项目已有 23 个 pytest 后端测试，但缺乏浏览器层面的 E2E 覆盖。建立独立 webtest 项目，
验证真实用户操作路径（登录、看板、发货、RBAC）。

**How**:
- Playwright TypeScript，单 worker 顺序执行（避免 SQLite 竞争）
- 种子脚本 `seed/seed.py`：通过 Flask app context 直接操作 DB，预占订单通过 test client
  调用 `/orders/sync` 确保 FIFO 分配逻辑正确写入
- 种子数据覆盖 3 类批次状态（expired/warning/healthy）供看板断言使用
- `helpers/auth.ts` 提供两种登录方式：UI 表单（测试登录流程本身）和 localStorage 注入（其他测试加速）

**Key files**:
- `seed/seed.py` — DB 重置与种子数据
- `fixtures/test-data.ts` — 与种子同步的常量
- `helpers/auth.ts` — 登录 helper
- `tests/auth/login.spec.ts`
- `tests/inventory/dashboard.spec.ts`
- `tests/orders/fulfill.spec.ts`
- `tests/rbac/access-control.spec.ts`

**Result**: 首次运行 18/18 通过（11s）。修复了一处 strict mode 问题：`getByText(/已发货/)` 同时匹配成功提示和 badge，改为精确匹配 `/订单 \d+ 已发货/` 并移除冗余断言。

## 2026-03-13 — Stage 2 边界与缺陷覆盖

**Why**: Stage 1 全绿并不代表代码正确——用户要求从业务角度主动发现 Bug，而非贴着实现验证。Stage 2 聚焦边界条件和已知缺陷，引入会"预期失败"的测试用例作为 Bug 报告。

**How**:
- 目录名用 `regression/`（r-e-g 排在 rbac/ 之后、reports/ 之前），确保此目录运行时 dashboard/fulfill/products 等依赖精确种子数的测试已全部通过。
- `regression/fifo.spec.ts`（7 个）：所有测试通过 API（`request` fixture）而非 UI，动态读取当前库存避免硬编码。覆盖：FIFO 跨批次分配量正确、超额预占 409、精确耗尽再预占 409、重复发货 409、不存在订单 404、未建档商品 404、未知渠道映射 409。
- `regression/inbound-edge.spec.ts`（8 个）：7 个合法性校验（无 batch_no、无 expiry_date、quantity=0/-1、cost=-1、未建档商品、日期格式错误），全部通过。1 个 `[已知缺陷]` 测试断言加权平均成本，**预期失败（FAIL），暴露 Bug-01**。
- `regression/expiry-boundary.spec.ts`（4 个）：通过 `beforeAll` 创建专属商品 HBBD 和 4 个边界批次（today-1/today/today+30/today+31），不影响已验证的看板计数。3 个基准断言通过，1 个 `[已知缺陷]` 测试断言今天到期 = expired，**预期失败（FAIL），暴露 Bug-02**。
- `reports/export.spec.ts`（8 个）：报表 + 账本导出，覆盖 CSV/xlsx 格式、Content-Disposition 头、staff 403、未登录 401/403、非法参数 400，全部通过。

**已发现 Bug**:
- **BUG-01** `app.py:295` — `batch.cost = cost` 直接覆盖，期望加权平均。测试失败：Expected ≈28.52, Received 99.0。
- **BUG-02** `services/import_service.py:13` — `expiry_date < today` 严格小于，今天到期被标记为 warning。测试失败：batchInExpired is undefined（batch 在 warning 列表中）。

**关键修复**（测试本身的修复，非主项目）：
- 成本覆盖测试原先硬编码 qty=200，改为先 GET 读取当前值再做差值断言，避免多次运行时累积状态导致测试自身错误。

**Result**: 75/75 测试中 73 通过，2 个 `[已知缺陷]` 测试按预期失败，成功定位主项目 2 处 Bug。

## 2026-03-13 — Stage 1 核心流程覆盖

**Why**: Stage 0 覆盖了登录/看板/订单/RBAC，Stage 1 补全入库操作、库存报表和商品管理三条主线路径。

**How**:
- `inbound.spec.ts`（7 个）：三步引导展示、条码/HB 编码识别、未知编码提示、完整入库提交、采购单位换算（2 盒 → 12 支）
- `stock-report.spec.ts`（8 个）：全部/过期/临期/健康筛选、批次卡片红/橙/绿背景颜色、到期日和商品名展示
- `products.spec.ts`（15 个）：列表/搜索/建档/导入按钮可见性、详情页批次列表、股票卡片结构、FIFO 不变式（API 层断言）

**关键修复**：
- strict mode：桌面 `<td>` 与移动 `<p>` 同名 → 改用 `getByRole('cell', ...)`
- 库存卡片 selector：`filter({ hasText: /^总库存$/ })` 精确匹配失败（div 含数字）→ 改为 `div.text-center` + `filter({ hasText: '总库存' })` + `.last()`
- 跨测试状态污染：`orders/fulfill` 会核销订单使 reserved_stock→0 → 改为 API 断言（总库存 ≥ 可售库存不变式）
- 测试与入库测试的 DB 隔离：入库只使用 HB002/HB003/HB001（限制副作用），商品详情断言不依赖精确数字

**Result**: 48/48 通过（41s）。已推送到 github.com/roseate-rose/roseate-wms-webtest。
