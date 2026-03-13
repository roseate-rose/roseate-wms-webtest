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
