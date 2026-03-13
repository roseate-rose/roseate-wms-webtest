# roseate-wms-webtest

Roseate-WMS 的 Playwright E2E 测试项目。对主项目（`~/Work/roseate-wms`）进行黑盒浏览器测试，独立于主项目的 pytest 单元/API 测试。

## 前置条件

- Node.js 18+
- Python 3.10+（需要能 import 主项目 backend）
- 主项目已安装后端依赖：`pip install -r ~/Work/roseate-wms/backend/requirements.txt`

## 初始安装

```bash
npm install
npm run setup   # 安装 Playwright Chromium 浏览器
```

## 运行流程

每次运行测试前需确保测试数据库是干净的种子状态：

```bash
# 步骤 1：停止主项目后端（如果正在运行）

# 步骤 2：重置测试数据库
npm run seed

# 步骤 3：启动主项目后端
cd ~/Work/roseate-wms && python3 backend/app.py &

# 步骤 4：启动主项目前端（另一个终端）
cd ~/Work/roseate-wms/frontend && npm run dev &

# 步骤 5：运行 E2E 测试
npm test

# 可选：带 UI 模式调试
npm run test:ui

# 查看测试报告
npm run test:report
```

## 项目结构

```
roseate-wms-webtest/
├── playwright.config.ts     # 测试配置，baseURL=localhost:5173
├── fixtures/
│   └── test-data.ts         # 种子数据常量（与 seed.py 保持同步）
├── helpers/
│   └── auth.ts              # 登录 helper（UI 登录 + localStorage 注入）
├── seed/
│   └── seed.py              # 重置并初始化测试 SQLite 数据库
├── tests/
│   ├── auth/
│   │   └── login.spec.ts
│   ├── inventory/
│   │   └── dashboard.spec.ts
│   ├── orders/
│   │   └── fulfill.spec.ts
│   └── rbac/
│       └── access-control.spec.ts
└── tasks/
    ├── todo.md              # 当前任务与测试 backlog
    └── devlog.md            # 开发日志
```

## 种子数据说明

`npm run seed` 会完全重置主项目数据库并写入以下测试数据：

| 类型 | 内容 |
|------|------|
| Users | `admin/Admin@123456`（admin），`staff/Staff@123456`（staff） |
| Products | HB001 蕴香玫瑰面霜, HB002 和本保湿精华, HB003 蕴香防晒乳 |
| Batches | BN-2024-01 已过期, BN-2026-01 临期, BN-2027-01 健康, BN-2026-04 临期 |
| ChannelMappings | taobao/SKU-HB001→HB001, taobao/SKU-HB002→HB002 |
| Orders | #1 taobao/SKU-HB001 qty=5 status=reserved |

## 主项目联动说明

以下主项目变更需同步更新 webtest：

- 新增 `adminOnly` 路由 → `tests/rbac/access-control.spec.ts`
- 登录表单 UI 改动 → `helpers/auth.ts` 中的 selector
- `localStorage` key 变更 → `helpers/auth.ts` 的 `injectToken`
- 批次/商品字段调整 → `seed/seed.py` + `fixtures/test-data.ts`
