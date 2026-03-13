# roseate-wms-webtest

Playwright E2E 测试项目，专用于对 **roseate-wms** 进行黑盒浏览器与 API 边界测试。
与主项目的 pytest 单元/集成测试互补，覆盖真实用户操作路径及业务边界缺陷。

---

## 依赖主项目

**主项目地址**：[https://github.com/roseate-rose/roseate-wms](https://github.com/roseate-rose/roseate-wms)

本项目是 **roseate-wms** 的独立 E2E 测试仓库，两者应克隆到同级目录下：

```
<workspace>/
├── roseate-wms/          ← 主项目（Flask + Vue 3，被测系统）
└── roseate-wms-webtest/  ← 本项目（Playwright E2E，测试系统）
```

`seed/seed.py` 通过相对路径 `../roseate-wms` 定位主项目，直接 import 其 backend 并操作 SQLite 数据库。也可通过环境变量覆盖数据库路径：

```bash
WMS_DB_PATH=/path/to/roseate_wms.db python3 seed/seed.py
```

---

## 两项目协作原则

### webtest 对主项目：**只读**

本项目 AI/开发者对主项目只有阅读权限，不主动修改主项目代码。

| 操作 | 说明 |
|------|------|
| ✅ 读取 `backend/app.py`、`models.py`、`services/` | 理解 API 行为、边界逻辑、RBAC 规则 |
| ✅ 读取 `backend/requirements.txt` | 确认依赖版本 |
| ✅ 读取 `frontend/src/` | 理解页面结构、路由、selector |
| ✅ 读取 `tasks/todo.md`、`tasks/devlog.md` | 了解主项目开发进度与背景 |
| ❌ 不修改主项目任何文件 | Bug 修复由主项目开发者负责 |
| ❌ 不在主项目 tasks/ 写 bug 文档 | Bug 记录统一维护在本项目 |

### 主项目对 webtest：**只读**

主项目开发者查阅 webtest 发现的问题，不修改 webtest 项目：

| 操作 | 说明 |
|------|------|
| ✅ 读取 `tasks/bugs.md` | 查看已发现的 Bug、复现步骤、修复建议 |
| ✅ 读取 `tasks/devlog.md` | 了解测试覆盖进度 |
| ❌ 不修改 webtest 测试代码 | 测试代码由 webtest 项目维护 |

### 理解主项目所依赖的文档

webtest 通过以下文件理解主项目行为，编写测试前必须阅读：

| 文件 | 用途 |
|------|------|
| `backend/app.py` | API 路由、RBAC 装饰器、业务逻辑（校验/分配/合并） |
| `backend/models.py` | 数据模型、字段约束、computed property（sellable_stock 等） |
| `backend/services/import_service.py` | `classify_expiry_status` 分类逻辑 |
| `frontend/src/router/` | 路由定义、前端 RBAC guard |
| `tasks/todo.md` | 主项目功能规划，了解哪些功能已上线 |

---

## Bug 追踪

**所有发现的 Bug 记录在本项目**：[`tasks/bugs.md`](./tasks/bugs.md)

每条记录包含：触发测试路径 · 复现步骤（API 级别）· 期望 vs 实际 · 建议修复代码。

当前已记录：

| ID | 严重度 | 描述 |
|----|--------|------|
| BUG-01 | 🔴 高 | 批次合并时成本被覆盖（应加权平均）|
| BUG-02 | 🟡 中 | 今天到期批次误判为 warning（应为 expired）|
| BUG-03 | 🔴 高 | 订单同步无幂等性，重复 webhook 创建重复订单 |
| BUG-04 | 🔴 高 | 商品条码无唯一约束，条码碰撞导致入库命中不确定 |
| BUG-05 | 🟡 中 | RBAC 不一致：staff 可创建单个商品但不能批量导入 |
| OBS-01 | 🟡 中 | 遗留调试端点 `/api/v1/inventory/test` 泄露用户身份 |
| OBS-02 | 🟡 中 | staff 可调用 `orders/fulfill` 永久扣减库存（待业务确认）|

---

## 前置条件

- Node.js 18+
- Python 3.10+（需要能 import 主项目 backend）
- 主项目已安装后端依赖：`pip install -r ../roseate-wms/backend/requirements.txt`

## 初始安装

```bash
npm install
npm run setup   # 安装 Playwright Chromium 浏览器
```

## 运行流程

每次完整测试前需先重置数据库：

```bash
# 步骤 1：停止主项目后端（seed 需要独占写 SQLite）

# 步骤 2：重置测试数据库
npm run seed

# 步骤 3：启动主项目后端
cd ../roseate-wms && python3 backend/app.py &

# 步骤 4：启动主项目前端（另一个终端）
cd ../roseate-wms/frontend && npm run dev &

# 步骤 5：运行 E2E 测试
npm test

# 可选：带 UI 模式调试
npm run test:ui
```

> **注意**：测试不自带 teardown，多次运行不 seed 会导致数据库状态累积，破坏依赖精确种子数的测试（如 dashboard 计数）。

## 测试结构

```
tests/
├── auth/               # 登录流程、auth guard
├── inventory/          # 看板、入库、库存报表
├── orders/             # 发货核销、订单同步
├── products/           # 商品列表、详情、搜索、CRUD
├── rbac/               # 前端路由 RBAC
├── regression/         # 边界用例与已知 Bug 复现（部分预期失败）
└── reports/            # 报表导出
```

**测试执行顺序**（按目录名字母序）：
`auth/ → inventory/ → orders/ → products/ → rbac/ → regression/ → reports/`

`regression/` 刻意排在 `rbac/` 之后、`reports/` 之前，
避免边界测试创建的脏数据影响 dashboard 等依赖精确种子数的断言。

## 种子数据说明

`npm run seed` 完全重置主项目数据库并写入：

| 类型 | 内容 |
|------|------|
| Users | `admin/Admin@123456`（admin），`staff/Staff@123456`（staff） |
| Products | HB001 蕴香玫瑰面霜, HB002 和本保湿精华, HB003 蕴香防晒乳 |
| Batches | BN-2024-01 已过期, BN-2026-01 临期, BN-2027-01 健康, BN-2026-04 临期 |
| ChannelMappings | taobao/SKU-HB001→HB001, taobao/SKU-HB002→HB002 |
| Orders | #1 taobao/SKU-HB001 qty=5 status=reserved |

## 主项目 UI 变更联动

以下主项目变更需同步更新 webtest：

| 主项目变更 | 需同步的 webtest 文件 |
|-----------|---------------------|
| 新增 adminOnly 路由 | `tests/rbac/access-control.spec.ts` |
| 登录表单 UI 改动 | `helpers/auth.ts` selector |
| localStorage key 变更 | `helpers/auth.ts` `injectToken` |
| 批次/商品字段调整 | `seed/seed.py` + `fixtures/test-data.ts` |
| API 响应结构变更 | 对应 `tests/regression/` 文件 |
