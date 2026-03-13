# Bug 跟踪

> 由 `roseate-wms-webtest` 边界测试自动发现。
> 每条记录包含：触发测试路径、复现步骤（API 级别）、期望 vs 实际行为、建议修复。

## 汇总

| ID | 严重度 | 状态 | 描述 |
|----|--------|------|------|
| BUG-01 | 🔴 高 | Open | 批次合并成本覆盖（应加权平均） |
| BUG-02 | 🟡 中 | Open | 今天到期批次误判为 warning |
| BUG-03 | 🔴 高 | Open | 订单同步无幂等性，重复 webhook 创建重复订单 |
| BUG-04 | 🔴 高 | Open | 商品条码无唯一约束，条码碰撞导致入库命中不确定 |
| BUG-05 | 🟡 中 | Open | RBAC 不一致：staff 可创建单个商品，但不能批量导入 |
| OBS-01 | 🟡 中 | Open | 遗留调试端点 `/api/v1/inventory/test` 泄露用户身份 |
| OBS-02 | 🟡 中 | Open | staff 可调用 `orders/fulfill` 永久扣减库存（是否符合业务意图？） |

---

---

## BUG-01 · 批次合并时成本被新值覆盖（应加权平均）

| 字段 | 内容 |
|------|------|
| **状态** | 🔴 Open |
| **严重度** | 高（成本核算错误，影响财务报表） |
| **位置** | `backend/app.py` → `apply_inbound_payload()` line 295 |
| **发现测试** | `tests/regression/inbound-edge.spec.ts` — `[已知缺陷] 批次合并时成本被覆盖而非加权平均` |

### 现有代码

```python
if batch:
    batch.current_quantity += normalized_quantity
    batch.initial_quantity += normalized_quantity
    batch.cost = cost          # ← 直接覆盖，丢失历史成本
```

### 复现步骤（API）

```bash
# 1. 首次入库：HB002 expiry=2027-01-01, qty=200, cost=25.0  (种子数据已存在)
# 2. 二次入库同批次（相同 expiry_date 触发 merge）
POST /api/v1/inventory/inbound
{
  "hb_code": "HB002",
  "batch_no": "BN-2027-01-MERGE",
  "expiry_date": "2027-01-01",
  "quantity": 10,
  "cost": 99.0
}
# 3. 查询批次成本
GET /api/v1/products/HB002
```

### 期望 vs 实际

| | 值 |
|--|--|
| **期望**（加权平均）| `(200 × 25.0 + 10 × 99.0) / 210 ≈ 28.52` |
| **实际**（被覆盖）| `99.0` |

### 建议修复

```python
if batch:
    total_qty = batch.current_quantity + normalized_quantity
    batch.cost = round(
        (batch.current_quantity * batch.cost + normalized_quantity * cost) / total_qty, 6
    ) if total_qty else cost
    batch.current_quantity += normalized_quantity
    batch.initial_quantity += normalized_quantity
```

---

## BUG-02 · 今天到期的批次被标记为 warning 而非 expired

| 字段 | 内容 |
|------|------|
| **状态** | 🔴 Open |
| **严重度** | 中（影响看板数量、库存筛选页，运营人员可能误判库存状态） |
| **位置** | `backend/services/import_service.py` → `classify_expiry_status()` line 13 |
| **发现测试** | `tests/regression/expiry-boundary.spec.ts` — `[已知缺陷] 到期日 = 今天 → 应为 expired，当前错误返回 warning` |

### 现有代码

```python
def classify_expiry_status(expiry_date, today=None):
    today = today or date.today()
    if expiry_date < today:       # ← 严格小于，今天到期 ≠ expired
        return "expired"
    if expiry_date <= date.fromordinal(today.toordinal() + 30):
        return "warning"
    return "healthy"
```

### 复现步骤（API）

```bash
# 1. 入库一个今天到期的批次（expiry_date = 运行当日）
POST /api/v1/inventory/inbound
{ "hb_code": "HB001", "batch_no": "BN-TODAY", "expiry_date": "<today>", "quantity": 5, "cost": 1.0 }

# 2. 查询过滤结果
GET /api/v1/inventory/expiry-report?status=expired   # → 不包含该批次（BUG）
GET /api/v1/inventory/expiry-report?status=warning   # → 包含该批次（BUG）
```

### 期望 vs 实际

| `expiry_date` | 期望 | 实际 |
|---|---|---|
| `today - 1` | `expired` | `expired` ✓ |
| `today` | `expired` | `warning` ✗ |
| `today + 30` | `warning` | `warning` ✓ |
| `today + 31` | `healthy` | `healthy` ✓ |

### 建议修复

```python
if expiry_date <= today:          # 改为 <=，今天到期视为已过期
    return "expired"
```

---

## BUG-03 · 订单同步无幂等性，重复调用创建重复订单

| 字段 | 内容 |
|------|------|
| **状态** | 🔴 Open |
| **严重度** | 高（电商 webhook 重推导致库存被多倍预占） |
| **位置** | `backend/app.py` → `create_sales_order()` / `sync_order()` |
| **发现测试** | `tests/regression/order-idempotency.spec.ts` — `[已知缺陷] 相同 channel+SKU 重复 sync` |

### 现有代码

```python
def create_sales_order(channel_name, external_sku_id, quantity, ...):
    mapping = ChannelMapping.query.filter_by(...).first()
    # ← 无 SalesOrder 重复检查
    order = SalesOrder(channel_name=..., external_sku_id=..., ...)
```

### 复现步骤

```bash
POST /api/v1/orders/sync {"channel_name":"taobao","external_sku_id":"SKU-HB001","quantity":1}
# → 200, order #N 创建，库存预占 1

POST /api/v1/orders/sync {"channel_name":"taobao","external_sku_id":"SKU-HB001","quantity":1}
# → 200, order #N+1 创建，库存再次预占 1（总共预占 2）
```

### 建议修复

```python
existing = SalesOrder.query.filter_by(
    channel_name=channel_name,
    external_sku_id=external_sku_id,
    status="reserved",
).first()
if existing:
    return None, None, "order already exists for this channel+sku"
```

---

## BUG-04 · 商品条码无唯一约束

| 字段 | 内容 |
|------|------|
| **状态** | 🔴 Open |
| **严重度** | 高（条码碰撞导致入库、识别命中不确定） |
| **位置** | `backend/models.py:59` Product.barcode 列；`app.py:826` create_product 校验 |
| **发现测试** | `tests/regression/barcode-collision.spec.ts` |

### 现有代码

```python
# models.py:59
barcode = db.Column(db.String(50), nullable=True, index=True)
# 无 unique=True

# app.py:826
if Product.query.filter_by(hb_code=hb_code).first():
    return api_response(code=409, ...)  # 只检查 hb_code，不检查 barcode
```

### 建议修复（双层）

```python
# models.py
barcode = db.Column(db.String(50), nullable=True, unique=True, index=True)

# app.py — create_product()
if barcode and Product.query.filter_by(barcode=barcode).first():
    return api_response(code=409, msg="barcode already exists")
```

---

## BUG-05 · RBAC 不一致：staff 可创建单个商品

| 字段 | 内容 |
|------|------|
| **状态** | 🟡 Open |
| **严重度** | 中（权限边界不清晰） |
| **位置** | `backend/app.py:800` `POST /api/v1/products` |
| **发现测试** | `tests/regression/rbac-api.spec.ts` — `[已知缺陷] staff 创建商品应返回 403` |

### 不一致点

| 端点 | 装饰器 | staff 可用？ |
|------|--------|------------|
| `POST /api/v1/products` | `@jwt_required()` | ✅ 可 |
| `POST /api/v1/products/import` | `@admin_required` | ❌ 不可 |
| `POST /api/v1/channel-mappings` | `@admin_required` | ❌ 不可 |

### 建议修复

```python
@app.post("/api/v1/products")
@admin_required   # 改为 admin_required，与 import 端点保持一致
def create_product():
```

---

## OBS-01 · 遗留调试端点泄露用户身份

| 字段 | 内容 |
|------|------|
| **状态** | 🟡 Open |
| **严重度** | 中（任何有效 JWT 均可获取用户名和角色） |
| **位置** | `backend/app.py:742` `GET /api/v1/inventory/test` |
| **发现测试** | `tests/regression/rbac-api.spec.ts` — `[安全观察] GET /api/v1/inventory/test` |

### 建议修复

删除该端点，或仅在 `app.config["DEBUG"]` 为 True 时注册。

---

## OBS-02 · staff 可执行发货核销（永久扣减库存）

| 字段 | 内容 |
|------|------|
| **状态** | 🟡 Open（待业务确认） |
| **严重度** | 中（取决于业务设计意图） |
| **位置** | `backend/app.py:1363` `POST /api/v1/orders/fulfill` |
| **发现测试** | `tests/regression/rbac-api.spec.ts` — `[安全观察] staff 可调用 fulfill` |

### 说明

发货核销会永久扣减 `current_quantity`，属于不可逆操作。
若业务上仓库员工（staff）需要发货，则属于设计意图，OBS-02 可关闭。
若只有管理员可操作，需将装饰器改为 `@admin_required`。
