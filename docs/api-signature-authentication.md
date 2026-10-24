# Autentikasi Request Signature (Service-to-Service)

Dokumentasi ini menjelaskan standar autentikasi dan pembuatan signature kriptografis berbasis **HMAC-SHA256** untuk seluruh komunikasi antar-service ke `billing-service`.

---

## 1. Ikhtisar Arsitektur

Sebagai pengganti token JWT yang bersifat *bearer* dan rentan replay bila tercecer di log/network, `billing-service` menggunakan **Request Signing berbasis HMAC-SHA256**:

```
+------------------+                                +--------------------+
|  Caller Service  |                                |   Billing Service  |
+------------------+                                +--------------------+
         |                                                     |
         | 1. Hitung SHA-256 Body                              |
         | 2. Susun Payload: METHOD:PATH:TIMESTAMP:BODY_HASH   |
         | 3. Hitung HMAC-SHA256 dengan API_KEY                |
         |                                                     |
         | 4. Kirim Request dengan Header:                     |
         |    - X-Api-Key: <key>                               |
         |    - X-Signature: <hmac-hex>                        |
         |    - X-Timestamp: <iso-atau-epoch-ms>               |
         | --------------------------------------------------> |
         |                                                     | 5. Cek ApiKey valid
         |                                                     | 6. Cek Timestamp <= 5 menit
         |                                                     | 7. Hitung expected signature
         |                                                     | 8. Constant-time comparison
         |                                                     |
         | <-------------------------------------------------- |
         |                200 OK Response                      |
```

### Keunggulan
1. **Integritas Payload (Tamper-Proof)**: Mengubah nominal, order ID, atau field sekecil apa pun pada request body akan membatalkan signature.
2. **Proteksi Replay Attack**: Setiap request dibatasi toleransi waktu maksimal **5 menit (300 detik)**. Request lama tidak bisa dikirim ulang oleh penyadap.
3. **Stateless & Cepat**: Tidak memerlukan query database tambahan atau external session store untuk verifikasi token.

---

## 2. Header Wajib

Setiap request ke seluruh endpoint non-webhook wajib menyertakan 3 header:

| Header | Format / Contoh | Keterangan |
|---|---|---|
| `X-Api-Key` | `sb-api-key-live-xxx` | Kunci rahasia bersama (Shared Secret Key) antara service pemanggil dan billing-service. |
| `X-Signature` | `c8afa9531677496ab9ab...` | Hash heksadesimal hasil HMAC-SHA256 (64 karakter). |
| `X-Timestamp` | `2026-10-24T14:00:00.000Z` atau `1729778400000` | Waktu pembuatan request (ISO 8601 string atau epoch timestamp dalam milidetik). |

---

## 3. Rumus Pembuatan Signature

### A. Format String yang Ditandatangani (*Payload to Sign*)
```text
${METHOD}:${PATH}:${TIMESTAMP}:${BODY_HASH}
```

- **`METHOD`**: Huruf kapital nama method HTTP (`GET`, `POST`, `PUT`, `DELETE`).
- **`PATH`**: Request URL path lengkap (contoh: `/api/v1/payments/snap`), diawali garis miring (`/`), tanpa query parameter.
- **`TIMESTAMP`**: String timestamp yang nilainya **harus sama persis** dengan yang dikirim di header `X-Timestamp`.
- **`BODY_HASH`**:
  - Untuk request dengan body (`POST`, `PUT`): `SHA256(JSON.stringify(body))`.
  - Untuk request tanpa body (`GET`, `DELETE`): string kosong `""`.

### B. Rumus HMAC
```text
Signature = HMAC_SHA256(PayloadToSign, API_KEY)
```
Output berupa format **lowercase hex string** (64 karakter).

---

## 4. Endpoint Generator Signature

Billing-service menyediakan endpoint pembantu bagi service lain yang ingin men-generate signature secara otomatis:

```http
POST /api/v1/signatures/generate
Content-Type: application/json
X-Api-Key: <your-api-key>
```

### Request Body:
```json
{
  "method": "POST",
  "path": "/api/v1/payments/snap",
  "timestamp": "2026-10-24T14:00:00.000Z",
  "body": {
    "orderId": "INV-20261024-0001",
    "amount": 150000
  }
}
```
*(Catatan: field `timestamp` bersifat opsional. Jika tidak diisi, sistem otomatis menggunakan waktu saat ini).*

### Response (200 OK):
```json
{
  "signature": "c8afa9531677496ab9ab7e971cda7249a8f5c34e595e3d0aacb865f4a13cba7b",
  "timestamp": "2026-10-24T14:00:00.000Z",
  "payloadToSign": "POST:/api/v1/payments/snap:2026-10-24T14:00:00.000Z:a8f5c3...",
  "headers": {
    "X-Api-Key": "<your-api-key>",
    "X-Signature": "c8afa9531677496ab9ab7e971cda7249a8f5c34e595e3d0aacb865f4a13cba7b",
    "X-Timestamp": "2026-10-24T14:00:00.000Z"
  }
}
```

---

## 5. Contoh Implementasi di Berbagai Bahasa

### TypeScript / Node.js
```typescript
import { createHash, createHmac } from 'node:crypto';
import axios from 'axios';

function createSignedHeaders(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const timestamp = new Date().toISOString();
  const bodyHash = body ? createHash('sha256').update(JSON.stringify(body)).digest('hex') : '';
  const payloadToSign = `${method.toUpperCase()}:${path}:${timestamp}:${bodyHash}`;
  const signature = createHmac('sha256', apiKey).update(payloadToSign).digest('hex');

  return {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
    'X-Signature': signature,
    'X-Timestamp': timestamp,
  };
}

// Penggunaan dengan Axios:
const payload = { orderId: 'INV-001', amount: 150000 };
const headers = createSignedHeaders(process.env.BILLING_API_KEY!, 'POST', '/api/v1/payments/snap', payload);

const res = await axios.post('http://billing-service:3504/api/v1/payments/snap', payload, { headers });
console.log(res.data);
```

### cURL / Bash
```bash
#!/bin/bash
API_KEY="my-secret-key"
METHOD="POST"
PATH_URL="/api/v1/payments/snap"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
BODY='{"orderId":"INV-001","amount":150000}'

# 1. Hitung SHA-256 dari Body
BODY_HASH=$(printf "%s" "$BODY" | openssl dgst -sha256 | awk '{print $2}')

# 2. Susun Payload to Sign
PAYLOAD="${METHOD}:${PATH_URL}:${TIMESTAMP}:${BODY_HASH}"

# 3. Hitung HMAC-SHA256 Signature
SIGNATURE=$(printf "%s" "$PAYLOAD" | openssl dgst -sha256 -hmac "$API_KEY" | awk '{print $2}')

# 4. Kirim Request
curl -X POST "http://localhost:3504$PATH_URL" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $API_KEY" \
  -H "X-Signature: $SIGNATURE" \
  -H "X-Timestamp: $TIMESTAMP" \
  -d "$BODY"
```

### Python
```python
import hashlib
import hmac
import json
import requests
from datetime import datetime, timezone

def call_billing_api(api_key: str, method: str, path: str, body: dict = None):
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    
    body_hash = ""
    json_data = None
    if body:
        json_data = json.dumps(body, separators=(',', ':'))
        body_hash = hashlib.sha256(json_data.encode('utf-8')).hexdigest()

    payload_to_sign = f"{method.upper()}:{path}:{timestamp}:{body_hash}"
    signature = hmac.new(api_key.encode('utf-8'), payload_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()

    headers = {
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
        "X-Signature": signature,
        "X-Timestamp": timestamp
    }

    url = f"http://localhost:3504{path}"
    return requests.request(method, url, headers=headers, data=json_data)
```

---

## 6. Cakupan Endpoint & Pengecualian

| Endpoint | Signature Wajib? | Keterangan |
|---|---|---|
| `POST /api/v1/webhooks/midtrans` | ❌ Tidak | Webhook publik penerima notifikasi dari Midtrans. Divalidasi menggunakan SHA-512 signature bawaan Midtrans. |
| `GET /api/health` | ❌ Tidak | Endpoint health check untuk container / orchestrator. |
| `GET /metrics` | ❌ Tidak | Endpoint metrics Prometheus untuk scraper. |
| `POST /api/v1/signatures/generate` | ❌ Tidak | Generator signature. Hanya membutuhkan `X-Api-Key`. |
| `POST /api/v1/payments/*` | ✅ **Wajib** | Seluruh transaksi Snap, QRIS, Virtual Account, dan Sync. |
| `GET /api/v1/payments/*` | ✅ **Wajib** | Pencarian status, histori transaksi, dan order list. |
| `GET /api/v1/payment-methods/*` | ✅ **Wajib** | Katalog bank VA. |

---

## 7. Penanganan Error (Error Codes)

Jika request tidak memenuhi standar autentikasi, server mengembalikan status `401 Unauthorized` dengan pesan spesifik:

| Pesan Error | Penyebab | Solusi |
|---|---|---|
| `Invalid or missing API key` | Header `X-Api-Key` kosong atau salah. | Periksa kecocokan `API_KEY` di konfigurasi pemanggil. |
| `Missing X-Signature header` | Header `X-Signature` tidak disertakan. | Sertakan hasil HMAC-SHA256 di header `X-Signature`. |
| `Missing X-Timestamp header` | Header `X-Timestamp` tidak disertakan. | Sertakan timestamp di header `X-Timestamp`. |
| `Invalid X-Timestamp header format` | Format timestamp bukan angka atau string ISO valid. | Gunakan format ISO 8601 (contoh: `2026-10-24T14:00:00.000Z`). |
| `Request signature expired` | Selisih waktu timestamp dengan jam server > 5 menit. | Pastikan jam server pemanggil sinkron via NTP. |
| `Invalid request signature` | Hasil perhitungan signature tidak cocok dengan payload/secret. | Pastikan `API_KEY`, urutan format string, dan hashing body sesuai panduan di atas. |
