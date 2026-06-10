#!/bin/sh
# 启动后向 API 自动注册本边缘节点（幂等：同名则更新）
if [ -n "$API_BASE" ] && [ -n "$EDGE_PUBLIC_URL" ]; then
  (
    sleep 5
    for i in $(seq 1 30); do
      code=$(curl -s -o /tmp/reg.out -w "%{http_code}" -X POST "$API_BASE/api/cdn/register" \
        -H "Content-Type: application/json" \
        -H "X-CDN-Register-Token: $REGISTER_TOKEN" \
        -d "{\"name\":\"$EDGE_NAME\",\"base_url\":\"$EDGE_PUBLIC_URL\"}")
      if [ "$code" = "200" ] || [ "$code" = "201" ]; then
        echo "[edge] registered to $API_BASE as $EDGE_NAME ($EDGE_PUBLIC_URL)"
        exit 0
      fi
      echo "[edge] register attempt $i failed (http $code), retrying..."
      sleep 5
    done
    echo "[edge] WARNING: failed to register edge node after retries: $(cat /tmp/reg.out)"
  ) &
fi
