# Bug 跟踪

> 由 `roseate-wms-webtest` 边界测试自动发现。
> 每条记录包含：触发测试路径、复现步骤（API 级别）、期望 vs 实际行为、建议修复。

## 汇总

| ID | 严重度 | 状态 | 描述 |
|----|--------|------|------|
| BUG-01 | 🔴 高 | ✅ Fixed | 批次合并成本覆盖（已改为加权平均，commit `28e49eb`） |
| BUG-02 | 🟡 中 | ✅ Fixed | 今天到期批次误判为 warning（`<=` 修复，commit `28e49eb`） |
| BUG-03 | 🔴 高 | ✅ Fixed | 订单同步幂等性（通过 `external_order_no` 去重，commit `8a3f36a`） |
| BUG-04 | 🔴 高 | ✅ Fixed | 商品条码 API 层唯一校验 + 入库歧义拦截（commit `4dfb0ad`） |
| BUG-05 | 🟡 中 | ✅ Fixed | `POST /api/v1/products` 改为 `@admin_required`（commit `4dfb0ad`） |
| OBS-01 | 🟡 中 | ✅ Fixed | `/api/v1/inventory/test` 仅 debug 模式注册，生产返回 404（commit `4dfb0ad`） |
| OBS-02 | 🟡 中 | ✅ Fixed | `orders/fulfill` 改为 `@admin_required`（commit `8a3f36a`） |
| BUG-06 | 🔴 高 | Open | FIFO 未过滤过期批次，订单预占过期库存（客户收到过期商品）|
| BUG-07 | 🔴 高 | Open | `/inventory/reserve` 创建孤儿预占：无订单记录、无释放 API，库存永久锁死 |
| BUG-08 | 🟡 中 | Open | `find_product` 静默降级：hb_code 不存在时自动用 barcode 替代，不返回 404 |
| OBS-03 | 🟡 中 | Open | 无订单取消 API：reserved 订单无法取消，预占库存无法通过正常流程释放 |

---

---

## BUG-01 · 批次合并时成本被新值覆盖（应加权平均）

| 字段 | 内容 |
|------|------|
| **状态** | ✅ Fixed（commit `28e49eb`） |
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
| **状态** | ✅ Fixed（commit `28e49eb`） |
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
| **状态** | ✅ Fixed（commit `8a3f36a`） |
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
| **状态** | ✅ Fixed（commit `4dfb0ad`） |
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
| **状态** | ✅ Fixed（commit `4dfb0ad`） |
| **严重度** | 中（权限边界不清晰） |
| **位置** | `backend/app.py` `POST /api/v1/products` |
| **验证测试** | `tests/regression/rbac-api.spec.ts` — `staff 调用 POST /api/v1/products 返回 403` |

### 修复后状态

| 端点 | 装饰器 | staff 可用？ |
|------|--------|------------|
| `POST /api/v1/products` | `@admin_required` | ❌ 不可（已修复） |
| `POST /api/v1/products/import` | `@admin_required` | ❌ 不可 |
| `POST /api/v1/channel-mappings` | `@admin_required` | ❌ 不可 |

---

## OBS-01 · 遗留调试端点泄露用户身份

| 字段 | 内容 |
|------|------|
| **状态** | ✅ Fixed（commit `4dfb0ad`） |
| **严重度** | 中（任何有效 JWT 均可获取用户名和角色） |
| **位置** | `backend/app.py` `GET /api/v1/inventory/test` |
| **验证测试** | `tests/regression/rbac-api.spec.ts` — `GET /api/v1/inventory/test 调试端点已移除` |

### 实际修复方式

端点仅在 `ENABLE_DEBUG_ENDPOINTS=1` 环境变量下注册，生产环境返回 404。

---

## OBS-02 · staff 可执行发货核销（永久扣减库存）

| 字段 | 内容 |
|------|------|
| **状态** | ✅ Fixed（commit `8a3f36a`） |
| **严重度** | 中（不可逆操作，需管理员权限） |
| **位置** | `backend/app.py` `POST /api/v1/orders/fulfill` |
| **验证测试** | `tests/regression/rbac-api.spec.ts` — `staff 调用 POST /api/v1/orders/fulfill 返回 403` |

### 业务决策

主项目选择将 fulfill 限制为 admin-only（`@admin_required`），避免 staff 执行不可逆的库存扣减。

---

## BUG-06 · FIFO 未过滤过期批次，订单预占过期库存

| 字段 | 内容 |
|------|------|
| **状态** | 🔴 Open |
| **严重度** | 高（客户可能收到过期商品，违反食品/化妆品安规） |
| **位置** | `backend/app.py` `reserve_product_inventory()` |
| **发现测试** | `tests/regression/fifo-expiry-filter.spec.ts` |

### 问题代码

```python
batches = (
    Batch.query.filter_by(hb_code=product.hb_code)
    .order_by(Batch.expiry_date.asc(), Batch.id.asc())
    .all()
    # ← 未过滤 expiry_date <= today 的过期批次
)
```

### 复现步骤

```bash
# 种子数据：HB001 有 BN-2024-01（expiry=2024-06-01，已过期，qty=50）
POST /api/v1/orders/sync {"channel_name":"taobao","external_sku_id":"SKU-HB001","quantity":1}
# → 200，allocations[0].expiry_date = "2024-06-01"（过期批次！）
```

### 期望 vs 实际

| | 行为 |
|--|--|
| **期望** | FIFO 跳过过期批次，从 BN-2026-01（未过期）分配 |
| **实际** | 从 BN-2024-01（已过期 21 个月）分配，expiry="2024-06-01" |

### 建议修复

```python
today = date.today()
batches = (
    Batch.query.filter_by(hb_code=product.hb_code)
    .filter(Batch.expiry_date > today)   # ← 只分配未过期批次
    .order_by(Batch.expiry_date.asc(), Batch.id.asc())
    .all()
)
```

同时，`sellable_stock` 也应排除过期批次：
```python
@property
def sellable_stock(self) -> int:
    today = date.today()
    return sum(
        batch.available_quantity for batch in self.batches
        if batch.available_quantity > 0 and batch.expiry_date > today
    )
```

---

## BUG-07 · /inventory/reserve 创建孤儿预占，库存永久锁死

| 字段 | 内容 |
|------|------|
| **状态** | 🔴 Open |
| **严重度** | 高（库存可被永久锁死，影响可售库存统计） |
| **位置** | `backend/app.py:1193` `POST /api/v1/inventory/reserve` |
| **发现测试** | `tests/regression/reserve-orphan.spec.ts` |

### 问题

`/inventory/reserve` 直接调用 `reserve_product_inventory()`，只修改 `batch.reserved_quantity`：
- 不创建 `SalesOrder` 记录
- 不创建 `OrderAllocation` 记录
- 系统中没有 `/inventory/unreserve` 或订单取消端点

结果：每次调用都永久增加 `reserved_quantity`，无法通过任何 API 路径释放。

### 复现步骤

```bash
# 查询初始可售库存
GET /api/v1/products/HB002 → sellable_stock=200

POST /api/v1/inventory/reserve {"hb_code":"HB002","quantity":5}
# → 200，reserved_quantity+5

GET /api/v1/products/HB002 → sellable_stock=195  ← 永久减少
GET /api/v1/orders?status=reserved               ← 没有对应订单
# 没有任何 API 可恢复到 200
```

### 建议修复

选项 A：移除此端点（直接使用 `orders/sync` 流程预占库存）
选项 B：要求关联订单 ID，通过 `orders/cancel` 释放

---

## BUG-08 · find_product 静默降级：hb_code 不存在时使用 barcode

| 字段 | 内容 |
|------|------|
| **状态** | 🟡 Open |
| **严重度** | 中（入库到错误商品，但无报错，难以发现） |
| **位置** | `backend/app.py:126` `find_product()` |
| **发现测试** | `tests/regression/inbound-product-lookup.spec.ts` |

### 问题代码

```python
def find_product(payload):
    if hb_code:
        product = Product.query.filter_by(hb_code=hb_code).first()
        if product:
            return product, None, None
        # ← hb_code 有值但找不到时，直接 fall through！
    if barcode:
        ...  # 静默使用 barcode 匹配的商品
```

### 复现步骤

```bash
POST /api/v1/inventory/inbound {
    "hb_code": "HB-GHOST-9999",   # 不存在
    "barcode": "6901234567890",    # HB001 的 barcode
    "batch_no": "BN-TEST", "expiry_date": "2030-01-01", "quantity": 1, "cost": 1.0
}
# 期望：404 (hb_code not found)
# 实际：200，入库到 HB001（通过 barcode 匹配）
```

### 建议修复

```python
def find_product(payload):
    if hb_code:
        product = Product.query.filter_by(hb_code=hb_code).first()
        if product:
            return product, None, None
        return None, f"product not found: {hb_code}", 404  # ← 明确报错
    if barcode:
        ...
```

---

## OBS-03 · 无订单取消 API，reserved 预占无法释放

| 字段 | 内容 |
|------|------|
| **状态** | 🟡 Open（功能缺失，建议补充） |
| **严重度** | 中（运营无法撤销误操作，库存长期虚减） |
| **位置** | 系统缺失 `DELETE /api/v1/orders/{id}` 或 `POST /api/v1/orders/cancel` |
| **发现测试** | `tests/regression/reserve-orphan.spec.ts` — cancel 端点均返回 404 |

### 场景

- 客服告知买家取消订单，WMS 中无法撤销对应 reserved 订单
- 重复下单（BUG-03 修复前）产生的多余订单无法清除
- 仅有 fulfill（永久出库）路径，无法"反悔"

### 建议

新增 `POST /api/v1/orders/cancel` 端点，释放 allocations 中的 `reserved_quantity`，将订单状态变更为 `cancelled`。
