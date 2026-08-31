#!/bin/bash
# วอร์ม + รีเซ็ตระบบ Flash Sale ก่อนยิง Load Test แต่ละรอบ (ไม่ restart container เลย)
# ใช้แทน `docker compose down -v` เวลาต้องทดสอบซ้ำหลายรอบ หรือให้กลุ่มอื่นมายิงต่อกัน
#
# รัน: ./warmup-and-reset.sh
# ปรับ target ได้ผ่าน env var เช่น: BASE_URL=http://localhost:8080/api/v1 ./warmup-and-reset.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080/api/v1}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-flashsalebackend-postgres-1}"
REDIS_CONTAINER="${REDIS_CONTAINER:-flashsalebackend-redis-1}"
DB_USER="${DB_USER:-myuser}"
DB_NAME="${DB_NAME:-flash_sale_db}"
DB_PASSWORD="${DB_PASSWORD:-mypassword}"
# ห้ามเปลี่ยนเป็น p-1001 เด็ดขาด — นั่นคือสินค้าที่โจทย์เช็คสต็อกจริงตอนพิสูจน์ Data Integrity
# ถ้าวอร์มด้วย p-1001 จะไปกินสต็อกที่ควรเหลือ 50 เป๊ะตอนเริ่มเทสต์จริง
WARMUP_PRODUCT="${WARMUP_PRODUCT:-p-1002}"

echo "=== [1/3] Reset database + Redis (ไม่ restart container) ==="
docker exec "$POSTGRES_CONTAINER" env PGPASSWORD="$DB_PASSWORD" psql -U "$DB_USER" -d "$DB_NAME" -c '
  UPDATE products SET "remainingStock" = "availableStock";
  DELETE FROM orders;
'
docker exec "$REDIS_CONTAINER" redis-cli FLUSHALL
echo "-> stock ทุกสินค้ากลับเต็ม, orders ว่าง, redis lock/cache/queue history ถูกล้างแล้ว"

echo ""
echo "=== [2/3] วอร์มระบบด้วย $WARMUP_PRODUCT (ไม่แตะสต็อก p-1001) ==="
TOKEN=$(curl -s -X POST "$BASE_URL/auth/token" \
  -H "Content-Type: application/json" -d '{"userId":"warmup-user"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: ขอ warmup token ไม่สำเร็จ — เช็คว่าเซิร์ฟเวอร์ขึ้นและ BASE_URL ถูกไหม ($BASE_URL)" >&2
  exit 1
fi

for i in $(seq 1 30); do curl -s "$BASE_URL/products?page=1&limit=10" > /dev/null; done
for i in $(seq 1 5); do
  curl -s -X POST "$BASE_URL/orders" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"productId\":\"$WARMUP_PRODUCT\"}" > /dev/null
done
sleep 3
echo "-> วอร์มเสร็จ (30 GET + 5 POST warm-up requests, ผ่านไปแล้ว 3 วินาทีให้ pool settle)"

echo ""
echo "=== [3/3] ยืนยันสต็อก p-1001 ==="
docker exec "$POSTGRES_CONTAINER" env PGPASSWORD="$DB_PASSWORD" psql -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT \"productId\", \"remainingStock\", \"availableStock\" FROM products WHERE \"productId\" = 'p-1001';"

echo ""
echo "READY — ระบบรีเซ็ตสะอาดและอุ่นเครื่องแล้ว ยิง k6 จริงได้เลย"
