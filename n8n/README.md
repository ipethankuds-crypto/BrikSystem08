# Brik Systems — n8n Lead Ingestion Integration (Part 4)

This directory contains the production-ready n8n workflow for receiving and processing real leads from **Brik Systems** via Supabase.

---

## 1. Workflow Architecture

```text
Brik Lead Creation (Dashboard or Web Form)
                     ↓
       Supabase PostgreSQL Database
                     ↓
   Server-Side Webhook Trigger (pg_net / Supabase Webhook)
                     ↓
   n8n Webhook Endpoint: POST /webhook/brik-lead-created
                     ↓
  [1] Security & Secret Verification (X-Brik-Webhook-Secret)
                     ↓
  [2] Schema Validation & Multi-Tenant Normalization
                     ↓
  [3] Idempotency & Deduplication Check (by lead_id)
                     ↓
  [4] Multi-Tenant Audit Logger (Logs client organization & lead info)
                     ↓
  [5] Return HTTP 200 { success: true, lead_id, organization_id }
```

---

## 2. How to Import the Workflow into n8n

1. Open your **n8n instance** (Self-hosted or n8n Cloud).
2. Click **Workflows** ➔ **Add workflow** (or press `Ctrl+O` / `Cmd+O`).
3. Click the **`...` (Options menu)** in the top right corner and select **Import from File**.
4. Select [`brik_lead_ingestion_workflow.json`](./brik_lead_ingestion_workflow.json).
5. Click **Save** and **Activate** (toggle to Active).

Your webhook endpoint will be available at:
- **Production URL**: `https://<your-n8n-domain>/webhook/brik-lead-created`
- **Test URL**: `https://<your-n8n-domain>/webhook-test/brik-lead-created`

---

## 3. How to Connect Supabase to n8n

### Option A: Supabase Dashboard Webhooks (Recommended & Simplest)

1. Open your [Supabase Project Dashboard](https://supabase.com/dashboard/project/qrrdmhwpiiwtixofyvqf).
2. Navigate to **Database** ➔ **Webhooks**.
3. Click **Create a new webhook**:
   - **Name**: `brik_leads_n8n`
   - **Table**: `leads`
   - **Events**: Check `Insert`
   - **Webhook Type**: `HTTP Request`
   - **HTTP Method**: `POST`
   - **HTTP URL**: `https://<your-n8n-domain>/webhook/brik-lead-created`
   - **HTTP Headers**:
     - Key: `X-Brik-Webhook-Secret`
     - Value: `your_webhook_secret_here`
4. Click **Create Webhook**.

---

### Option B: PostgreSQL Trigger (`pg_net`)

If you prefer SQL-level configuration, execute this in [Supabase SQL Editor](https://supabase.com/dashboard/project/qrrdmhwpiiwtixofyvqf/sql/new):

```sql
-- Enable HTTP networking extension
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Function to dispatch HTTP POST to n8n
CREATE OR REPLACE FUNCTION public.dispatch_lead_to_n8n()
RETURNS TRIGGER AS $$
DECLARE
  payload JSONB;
BEGIN
  payload := jsonb_build_object(
    'lead_id', NEW.id,
    'organization_id', NEW.organization_id,
    'name', NEW.name,
    'first_name', NEW.first_name,
    'last_name', NEW.last_name,
    'email', NEW.email,
    'phone', NEW.phone,
    'service_requested', NEW.service_requested,
    'source', NEW.source,
    'status', NEW.status,
    'notes', NEW.notes,
    'created_at', NEW.created_at
  );

  PERFORM net.http_post(
    url := 'https://<your-n8n-domain>/webhook/brik-lead-created',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Brik-Webhook-Secret', 'brik_sec_default_2026'
    ),
    body := payload
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on leads INSERT
DROP TRIGGER IF EXISTS on_lead_inserted_send_n8n ON public.leads;
CREATE TRIGGER on_lead_inserted_send_n8n
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_lead_to_n8n();
```

---

## 4. Multi-Tenant Preservation

Every lead sent to n8n includes the `organization_id`. n8n logs and routes the workflow according to this ID:

```json
{
  "lead_id": "c7a84e20-3b91-49fa-92b1-d55c704fbc51",
  "organization_id": "00000000-0000-0000-0000-000000000001",
  "organization_name": "Northside Plumbing & Heating",
  "first_name": "John",
  "last_name": "Test",
  "name": "John Test",
  "email": "john@example.com",
  "phone": "(416) 555-0000",
  "service_requested": "Drain Cleaning",
  "source": "Manual Entry",
  "status": "New",
  "created_at": "2026-08-31T21:30:00.000Z"
}
```

---

## 5. Duplicate Prevention / Idempotency

The n8n workflow includes a dedicated **Check Idempotency** code node that uses `lead_id` as the idempotency key:
- If a webhook event with the same `lead_id` is received again (e.g. from network retries), the workflow detects that it has already been processed.
- It returns HTTP 200 with `is_duplicate: true` and skips downstream notifications, preventing duplicate customer outreach.

---

## 6. End-to-End Testing

1. In n8n, open the workflow and click **Listen for test event** on the Webhook node.
2. Open [`index.html`](../index.html) in your browser.
3. Log in with `dexter125555@gmail.com`.
4. Go to **Leads** and click **+ Add Lead**.
5. Fill in:
   - **Name**: `John Test`
   - **Phone**: `(416) 555-0000`
   - **Email**: `john@example.com`
   - **Service**: `Drain Cleaning`
   - **Status**: `New`
6. Click **Save to Database**.
7. In n8n, inspect the execution log:
   - Webhook received payload.
   - Verified secret and schema.
   - Identified `organization_id`.
   - Logged lead audit.
   - Returned HTTP 200.
