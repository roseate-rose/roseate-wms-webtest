# Webtest Todo

## Stage 0 — 框架搭建（完成）

- [x] Playwright + TypeScript 项目初始化
- [x] `playwright.config.ts`：baseURL、单 worker、chromium
- [x] `seed/seed.py`：重置 DB，写入用户/商品/批次/渠道映射/预占订单
- [x] `fixtures/test-data.ts`：与种子数据对齐的常量
- [x] `helpers/auth.ts`：UI 登录 + localStorage token 注入
- [x] `tests/auth/login.spec.ts`：登录成功、密码错误、auth guard
- [x] `tests/inventory/dashboard.spec.ts`：过期/临期/健康计数 + 卡片跳转
- [x] `tests/orders/fulfill.spec.ts`：订单列表、发货核销、新订单同步
- [x] `tests/rbac/access-control.spec.ts`：admin/staff 路由访问控制
- [x] `README.md`：运行流程、结构说明、联动规则
- [x] 首次实际运行，18/18 通过，修正 strict mode selector 偏差

## Stage 1 — 核心业务流程补全（完成）

- [x] `tests/inventory/inbound.spec.ts`：H5 入库，条码/HB 编码识别，批次表单，采购单位换算
- [x] `tests/inventory/stock-report.spec.ts`：/stock 页状态筛选，行背景颜色校验
- [x] `tests/products/products.spec.ts`：商品列表、搜索（名称/编码/条码）、建档、详情页批次明细、FIFO 不变式
- [ ] `tests/reports/export.spec.ts`：admin 下载 CSV/xlsx，验证 Content-Disposition

## Stage 2 — 批量导入流程

- [ ] `tests/inbound-import/inbound-import.spec.ts`：上传 CSV → 预览 → 提交 → 验证库存
- [ ] `tests/orders-import/orders-import.spec.ts`：上传订单 CSV → 预览 → 提交 → 验证预占

## 已知问题 / 待确认

- `helpers/auth.ts` 中 `injectToken` 使用的 localStorage key 需首次运行后验证
- 种子日期基准 2026-03-13，warning 窗口 ≤30 天；若运行时日期偏移需重新评估 expiry_date
