# Bug 跟踪

> 由 `roseate-wms-webtest` 边界测试自动发现。
> 每条记录包含：触发测试路径、复现步骤（API 级别）、期望 vs 实际行为、建议修复。

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
