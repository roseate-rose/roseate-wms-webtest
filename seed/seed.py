"""
Seed script for roseate-wms E2E tests.

Creates a fresh SQLite database with known test data at:
  ../roseate-wms/instance/roseate_wms.db  (default)

Override with env var:
  WMS_DB_PATH=/path/to/roseate_wms.db python3 seed/seed.py

USAGE
-----
1. Stop the roseate-wms backend if it is running.
2. Run:  cd roseate-wms-webtest && python3 seed/seed.py
3. Start the roseate-wms backend:  python3 backend/app.py
4. Run tests:  npx playwright test

TEST DATA SUMMARY
-----------------
Users:
  admin  / Admin@123456  (role=admin)
  staff  / Staff@123456  (role=staff)

Products & batches:
  HB001  蕴香玫瑰面霜  base_unit=支 purchase_unit=盒 conversion_rate=6
    BN-2024-01  expiry 2024-06-01  qty=50  → EXPIRED
    BN-2026-01  expiry 2026-03-30  qty=100 → WARNING (17 days from seed date 2026-03-13)
  HB002  和本保湿精华  unit=瓶
    BN-2027-01  expiry 2027-01-01  qty=200 → HEALTHY
  HB003  蕴香防晒乳    unit=支
    BN-2026-04  expiry 2026-04-10  qty=80  → WARNING (28 days from seed date 2026-03-13)

Channel mappings:
  taobao / SKU-HB001 → HB001
  taobao / SKU-HB002 → HB002

Orders (pre-seeded via /orders/sync):
  #1  taobao / SKU-HB001  qty=5  status=reserved
      FIFO allocation: BN-2024-01 (expired batch, earliest expiry)
"""

import os
import sys
from datetime import date
from pathlib import Path

# ---------------------------------------------------------------------------
# Path setup: add main project root to sys.path so backend imports work
# ---------------------------------------------------------------------------
MAIN_PROJECT = (Path(__file__).resolve().parents[2] / "roseate-wms").resolve()
if not MAIN_PROJECT.exists():
    print(f"ERROR: main project not found at {MAIN_PROJECT}")
    sys.exit(1)

sys.path.insert(0, str(MAIN_PROJECT))
# chdir so Flask resolves relative paths (e.g. FRONTEND_DIST_DIR) correctly
os.chdir(MAIN_PROJECT)

DB_PATH = Path(
    os.environ.get("WMS_DB_PATH", str(MAIN_PROJECT / "instance" / "roseate_wms.db"))
).resolve()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Import backend (must happen after sys.path is set)
# ---------------------------------------------------------------------------
from backend.app import create_app, ensure_default_admin  # noqa: E402
from backend.extensions import db  # noqa: E402
from backend.models import (  # noqa: E402
    Batch,
    ChannelMapping,
    OrderAllocation,
    Product,
    SalesOrder,
    User,
)

# ---------------------------------------------------------------------------
# Create app pointing at the file-based DB
# ---------------------------------------------------------------------------
app = create_app(
    {
        "TESTING": False,
        "JWT_SECRET_KEY": "webtest-seed-key-minimum-32-chars-xxx",
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{DB_PATH}",
        "DEFAULT_ADMIN_USERNAME": "admin",
        "DEFAULT_ADMIN_PASSWORD": "Admin@123456",
        "DEFAULT_ADMIN_ROLE": "admin",
        # Provide a dummy frontend dir (seed does not serve static files)
        "FRONTEND_DIST_DIR": str(MAIN_PROJECT / "frontend" / "dist"),
    }
)

with app.app_context():
    print(f"Resetting DB at: {DB_PATH}")
    db.drop_all()
    db.create_all()

    # --- Users ---
    ensure_default_admin(app)  # creates admin / Admin@123456

    staff = User(username="staff", role="staff")
    staff.set_password("Staff@123456")
    db.session.add(staff)

    # --- Products ---
    p1 = Product(
        hb_code="HB001", barcode="6901234567890",
        name="蕴香玫瑰面霜", spec="50ml/支", unit="支",
        base_unit="支", purchase_unit="盒", conversion_rate=6,
    )
    p2 = Product(
        hb_code="HB002", barcode="6901234567891",
        name="和本保湿精华", spec="30ml/瓶", unit="瓶",
        base_unit="瓶", purchase_unit="瓶", conversion_rate=1,
    )
    p3 = Product(
        hb_code="HB003", barcode="6901234567892",
        name="蕴香防晒乳", spec="40ml/支", unit="支",
        base_unit="支", purchase_unit="支", conversion_rate=1,
    )
    db.session.add_all([p1, p2, p3])
    db.session.flush()

    # --- Batches ---
    b1 = Batch(
        hb_code="HB001", batch_no="BN-2024-01",
        production_date=date(2024, 1, 1), expiry_date=date(2024, 6, 1),
        cost=10.0, initial_quantity=50, current_quantity=50, reserved_quantity=0,
    )
    b2 = Batch(
        hb_code="HB001", batch_no="BN-2026-01",
        production_date=date(2025, 12, 1), expiry_date=date(2026, 3, 30),
        cost=12.0, initial_quantity=100, current_quantity=100, reserved_quantity=0,
    )
    b3 = Batch(
        hb_code="HB002", batch_no="BN-2027-01",
        production_date=date(2026, 1, 1), expiry_date=date(2027, 1, 1),
        cost=25.0, initial_quantity=200, current_quantity=200, reserved_quantity=0,
    )
    b4 = Batch(
        hb_code="HB003", batch_no="BN-2026-04",
        production_date=date(2025, 10, 1), expiry_date=date(2026, 4, 10),
        cost=15.0, initial_quantity=80, current_quantity=80, reserved_quantity=0,
    )
    db.session.add_all([b1, b2, b3, b4])
    db.session.flush()

    # --- Channel mappings ---
    cm1 = ChannelMapping(channel_name="taobao", external_sku_id="SKU-HB001", hb_code="HB001")
    cm2 = ChannelMapping(channel_name="taobao", external_sku_id="SKU-HB002", hb_code="HB002")
    db.session.add_all([cm1, cm2])
    db.session.commit()

    # --- Pre-seed a reserved order via the API test client ---
    # Using the test client ensures FIFO allocation logic is applied correctly.
    client = app.test_client()

    login_resp = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "Admin@123456"},
    )
    token = login_resp.get_json()["data"]["token"]
    headers = {"Authorization": f"Bearer {token}"}

    sync_resp = client.post(
        "/api/v1/orders/sync",
        json={"channel_name": "taobao", "external_sku_id": "SKU-HB001", "quantity": 5},
        headers=headers,
    )
    sync_data = sync_resp.get_json()
    if sync_resp.status_code != 200:
        print(f"WARNING: order sync failed: {sync_data}")
    else:
        order_id = sync_data["data"]["order"]["id"]
        print(f"Seeded reserved order #{order_id}  taobao/SKU-HB001  qty=5")

print("Seed complete.")
print(f"  DB:    {DB_PATH}")
print("  Users: admin/Admin@123456  staff/Staff@123456")
print("  Products: HB001 HB002 HB003")
print("  Batches:  1 expired, 2 warning, 1 healthy")
