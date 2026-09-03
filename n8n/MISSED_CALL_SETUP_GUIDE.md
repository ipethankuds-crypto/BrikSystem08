# Brik Systems — Automation 1: Missed Call → Automatic SMS Setup Guide

This guide walks you through setting up and running **Automation 1 (Missed Call → Automatic SMS)** with **Twilio**, **n8n**, and **Supabase**.

---

## 1. How the Architecture Works

```text
1. Customer dials Client's Twilio Phone Number (+14165550199)
                          ↓
2. Twilio rings Client's Real Forwarding Phone (+14165550100)
                          ↓
   [Client Answers] ─────────────➔ Call completes normally (NO SMS sent)
   [Client Misses Call] ─────────➔ Status callback triggers with 'no-answer' / 'busy'
                          ↓
3. Twilio sends webhook to n8n: POST /webhook/brik-missed-call
                          ↓
4. n8n identifies client organization by 'To' number
                          ↓
5. n8n checks idempotency by CallSid (prevents duplicate SMS)
                          ↓
6. Customer upserted in Supabase (customers table) & Call logged (calls table)
                          ↓
7. Twilio sends SMS to Customer:
   "Hey, sorry we missed your call at Northside Plumbing & Heating! We're currently helping another customer, but we'll get back to you ASAP. In the meantime, you can fill out this quick form: https://briksystems.io/#/contact"
                          ↓
8. Outbound SMS saved in Supabase (messages table)
                          ↓
9. Customer replies via SMS ➔ Twilio webhook POST /webhook/brik-incoming-sms ➔ Saved in Supabase
```

---

## 2. Twilio Phone Number Configuration

In your [Twilio Console](https://console.twilio.com/):

### A. Voice Configuration (for Missed Call Detection)
1. Go to **Phone Numbers ➔ Manage ➔ Active numbers** and click your phone number.
2. Under **Voice Configuration**:
   - **Configure With**: Webhook / TwiML Bin
   - **A CALL COMES IN**: Webhook `POST https://<your-n8n-domain>/webhook/brik-missed-call`
   - **CALL STATUS CHANGES (Status Callback)**: Webhook `POST https://<your-n8n-domain>/webhook/brik-missed-call`
   - Check the boxes for: `initiated`, `ringing`, `answered`, `completed`.

> **TwiML Call Forwarding (To Ring Your Real Phone First)**:
> If you want Twilio to forward the call to your mobile phone before triggering missed call detection, use this TwiML in your Twilio Voice URL:
> ```xml
> <?xml version="1.0" encoding="UTF-8"?>
> <Response>
>   <Dial action="https://<your-n8n-domain>/webhook/brik-missed-call" timeout="20">
>     +14165550100
>   </Dial>
> </Response>
> ```

---

### B. Messaging Configuration (for Incoming SMS Replies)
1. In the same phone number settings, scroll to **Messaging Configuration**:
   - **A MESSAGE COMES IN**: Webhook `POST https://<your-n8n-domain>/webhook/brik-incoming-sms`
2. Click **Save**.

---

## 3. n8n Workflow Import

1. Open your **n8n dashboard**.
2. Import the two workflow files:
   - 📄 [`n8n/brik_missed_call_workflow.json`](./brik_missed_call_workflow.json)
   - 📄 [`n8n/brik_incoming_sms_workflow.json`](./brik_incoming_sms_workflow.json)
3. For both workflows, click **Save** and toggle to **Active**.

---

## 4. Supabase Database Schema

If you haven't run the updated database schema yet:
1. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/qrrdmhwpiiwtixofyvqf/sql/new).
2. Copy and run the entire [`supabase_schema.sql`](../supabase_schema.sql).
3. This creates:
   - `automation_settings`: Stores client's custom message template, form URL, and business name.
   - `customers`: Multi-tenant contact records with unique index on `(organization_id, phone)`.
   - `calls`: Inbound call logs with unique `twilio_call_sid`.
   - `messages`: Outbound and inbound SMS logs with `message_type: 'MISSED_CALL'`.

---

## 5. Testing Automation 1 End-to-End

### Scenario 1: Unanswered Call (Triggers Automatic SMS)
1. Call your Twilio phone number from your mobile phone.
2. Let it ring out (or decline the call on the forwarding phone).
3. **Verify**:
   - Twilio detects call status `no-answer` / `busy`.
   - n8n receives the webhook.
   - You receive an SMS: *"Hey, sorry we missed your call at Northside Plumbing & Heating! ... "*
   - Open Supabase:
     - `customers` table contains your phone number.
     - `calls` table contains the call record with `sms_sent: true`.
     - `messages` table contains the outbound SMS record.

### Scenario 2: Answered Call (No SMS)
1. Call your Twilio phone number.
2. Answer the call on your forwarding phone and talk for 5 seconds.
3. Hang up.
4. **Verify**:
   - Twilio reports status `completed` with duration > 0.
   - n8n filters out the call.
   - **NO SMS** is sent.

### Scenario 3: Duplicate Call Event (Idempotency)
1. If Twilio retries or sends the same `CallSid` twice:
2. n8n detects `CallSid` in its idempotency cache.
3. The duplicate event is safely skipped with **no duplicate SMS**.

### Scenario 4: Incoming SMS Reply
1. Reply to the automatic SMS on your phone: *"Yes, can someone come quote a water heater?"*
2. **Verify**:
   - Twilio forwards the message to `/webhook/brik-incoming-sms`.
   - Supabase `messages` table records the incoming message with `direction: 'INBOUND'`, `message_type: 'INBOUND_REPLY'`, and `status: 'RECEIVED'`.
