// Mirrors the state produced by seed/seed.py
// Update this file whenever the seed script changes

export const ADMIN = { username: 'admin', password: 'Admin@123456' };
export const STAFF = { username: 'staff', password: 'Staff@123456' };

export const PRODUCTS = {
  HB001: { hb_code: 'HB001', name: '蕴香玫瑰面霜', barcode: '6901234567890' },
  HB002: { hb_code: 'HB002', name: '和本保湿精华', barcode: '6901234567891' },
  HB003: { hb_code: 'HB003', name: '蕴香防晒乳',   barcode: '6901234567892' },
};

// Relative to seed date 2026-03-13:
//   BN-2024-01  expired  2024-06-01  qty=50
//   BN-2026-01  warning  2026-03-30  qty=100   (17 days out)
//   BN-2027-01  healthy  2027-01-01  qty=200
//   BN-2026-04  warning  2026-04-10  qty=80    (28 days out)
export const BATCHES = {
  HB001_expired: { batch_no: 'BN-2024-01', expiry_date: '2024-06-01', qty: 50 },
  HB001_warning: { batch_no: 'BN-2026-01', expiry_date: '2026-03-30', qty: 100 },
  HB002_healthy: { batch_no: 'BN-2027-01', expiry_date: '2027-01-01', qty: 200 },
  HB003_warning: { batch_no: 'BN-2026-04', expiry_date: '2026-04-10', qty: 80 },
};

// Dashboard expected counts
export const DASHBOARD = {
  expired_count: 1,   // HB001 BN-2024-01
  warning_count: 2,   // HB001 BN-2026-01, HB003 BN-2026-04
  healthy_count: 1,   // HB002 BN-2027-01
};

export const CHANNEL_MAPPINGS = {
  taobao_HB001: { channel_name: 'taobao', external_sku_id: 'SKU-HB001', hb_code: 'HB001' },
  taobao_HB002: { channel_name: 'taobao', external_sku_id: 'SKU-HB002', hb_code: 'HB002' },
};

// Seeded reserved order (created via /orders/sync in seed.py)
export const SEED_ORDER = {
  channel_name: 'taobao',
  external_sku_id: 'SKU-HB001',
  hb_code: 'HB001',
  quantity: 5,
  status: 'reserved',
};
