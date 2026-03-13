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
