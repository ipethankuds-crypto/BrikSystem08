-- ==============================================================================
-- Brik Systems Multi-Tenant SaaS PostgreSQL Database Schema & Security
-- Core Foundation: Multi-Tenant Organizations, Profiles, Leads CRM,
-- Automation 1: Missed Call → Automatic SMS, Twilio Phone Routing, Calls, Messages
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENUMS & CUSTOM TYPES
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('ADMIN', 'CLIENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE job_status AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. ORGANIZATIONS TABLE (CLIENT BUSINESSES / TENANTS)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    business_type VARCHAR(100) DEFAULT 'Local Business',
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(20),
    twilio_phone_number VARCHAR(50) UNIQUE, -- Dedicated Twilio tracking number for this client (e.g. +14165550199)
    forwarding_phone_number VARCHAR(50),    -- Business owner's real phone where calls ring (e.g. +14165550100)
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. PROFILES TABLE (USERS LINKED TO SUPABASE AUTH & AN ORGANIZATION)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'CLIENT',
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    avatar_url TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. AUTOMATION SETTINGS TABLE (CLIENT CUSTOMIZATION FOR AUTOMATION 1: MISSED CALL SMS)
CREATE TABLE IF NOT EXISTS automation_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    missed_call_sms_enabled BOOLEAN NOT NULL DEFAULT true,
    missed_call_sms_template TEXT NOT NULL DEFAULT 'Hey, sorry we missed your call! We are currently helping another customer, but we will get back to you as soon as possible. In the meantime, you can fill out this quick form so we can get the details of what you need: {{form_url}}',
    form_url TEXT NOT NULL DEFAULT 'https://briksystems.io/#/contact',
    business_name VARCHAR(255),
    sms_delay_seconds INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 6. CUSTOMERS / CONTACTS TABLE (MULTI-TENANT CONTACT DIRECTORY)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(20),
    last_call_at TIMESTAMPTZ,
    call_status VARCHAR(50),
    source VARCHAR(100) DEFAULT 'Missed Call',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_customer_org_phone UNIQUE (organization_id, phone)
);

-- 7. CALLS TABLE (CALL LOGS & IDEMPOTENCY TRACKING)
CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    from_number VARCHAR(50) NOT NULL,
    to_number VARCHAR(50) NOT NULL,
    direction VARCHAR(20) NOT NULL DEFAULT 'inbound', -- 'inbound', 'outbound'
    call_status VARCHAR(50) NOT NULL,                 -- 'no-answer', 'busy', 'canceled', 'failed', 'completed'
    twilio_call_sid VARCHAR(100) UNIQUE NOT NULL,    -- Idempotency key from Twilio
    duration INT DEFAULT 0,
    sms_sent BOOLEAN NOT NULL DEFAULT false,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 8. MESSAGES TABLE (SMS INTERACTION HISTORY & AUDIT)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
    from_number VARCHAR(50) NOT NULL,
    to_number VARCHAR(50) NOT NULL,
    message_body TEXT NOT NULL,
    message_type VARCHAR(50) NOT NULL DEFAULT 'MISSED_CALL', -- 'MISSED_CALL', 'INBOUND_REPLY', 'REVIEW_REQUEST', 'MANUAL'
    direction VARCHAR(20) NOT NULL DEFAULT 'OUTBOUND',       -- 'OUTBOUND', 'INBOUND'
    status VARCHAR(50) NOT NULL DEFAULT 'SENT',              -- 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED'
    twilio_message_sid VARCHAR(100) UNIQUE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 9. LEADS TABLE (REAL MULTI-TENANT LEADS CRM)
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    service_requested VARCHAR(255),
    source VARCHAR(100) DEFAULT 'Manual Entry',
    status VARCHAR(50) NOT NULL DEFAULT 'New', -- 'New', 'Contacted', 'Qualified', 'Booked', 'Won', 'Lost'
    notes TEXT,
    webhook_status VARCHAR(50) DEFAULT 'pending',
    webhook_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 10. FUTURE DATA TABLES (JOBS & REVIEWS)
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(255) NOT NULL,
    service VARCHAR(255) NOT NULL,
    price NUMERIC(10, 2) DEFAULT 0.00,
    status job_status NOT NULL DEFAULT 'PENDING',
    scheduled_date DATE,
    time_window VARCHAR(50),
    technician VARCHAR(100),
    notes TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    author_name VARCHAR(255) NOT NULL,
    service VARCHAR(255),
    rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    status VARCHAR(50) DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 11. WEBHOOK LOGS TABLE
CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL DEFAULT 'lead.created',
    endpoint_url TEXT NOT NULL DEFAULT 'https://n8n.yourdomain.com/webhook/brik-lead-created',
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    response_status INT,
    response_body TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 12. SECURITY HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION get_auth_user_organization_id()
RETURNS UUID AS $$
DECLARE
    v_org_id UUID;
BEGIN
    SELECT organization_id INTO v_org_id
    FROM profiles
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_brik_admin()
RETURNS BOOLEAN AS $$
DECLARE
    v_role user_role;
BEGIN
    SELECT role INTO v_role
    FROM profiles
    WHERE id = auth.uid()
    LIMIT 1;

    RETURN (v_role = 'ADMIN');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 13. AUTO-PROVISIONING TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    new_org_id UUID;
    user_name TEXT;
    company_name TEXT;
    company_slug TEXT;
BEGIN
    user_name := COALESCE(NEW.raw_user_meta_data->>'full_name', initcap(split_part(NEW.email, '@', 1)));
    company_name := COALESCE(NEW.raw_user_meta_data->>'organization_name', user_name || '''s Company');
    company_slug := lower(regexp_replace(company_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text), 1, 6);

    -- 1. Create new organization automatically
    INSERT INTO public.organizations (name, slug, email)
    VALUES (company_name, company_slug, NEW.email)
    RETURNING id INTO new_org_id;

    -- 2. Create default automation settings for Automation 1
    INSERT INTO public.automation_settings (organization_id, business_name)
    VALUES (new_org_id, company_name)
    ON CONFLICT (organization_id) DO NOTHING;

    -- 3. Create user profile automatically
    INSERT INTO public.profiles (id, organization_id, role, full_name, email)
    VALUES (NEW.id, new_org_id, 'CLIENT', user_name, NEW.email)
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 14. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

-- ORGANIZATIONS POLICIES:
DROP POLICY IF EXISTS "Admins have full access to all organizations" ON organizations;
CREATE POLICY "Admins have full access to all organizations"
    ON organizations FOR ALL TO authenticated USING (is_brik_admin()) WITH CHECK (is_brik_admin());

DROP POLICY IF EXISTS "Clients can view their own organization" ON organizations;
CREATE POLICY "Clients can view their own organization"
    ON organizations FOR SELECT TO authenticated USING (id = get_auth_user_organization_id());

DROP POLICY IF EXISTS "Clients can update their own organization" ON organizations;
CREATE POLICY "Clients can update their own organization"
    ON organizations FOR UPDATE TO authenticated USING (id = get_auth_user_organization_id()) WITH CHECK (id = get_auth_user_organization_id());

-- PROFILES POLICIES:
DROP POLICY IF EXISTS "Admins have full access to all profiles" ON profiles;
CREATE POLICY "Admins have full access to all profiles"
    ON profiles FOR ALL TO authenticated USING (is_brik_admin()) WITH CHECK (is_brik_admin());

DROP POLICY IF EXISTS "Users can view profiles in their own organization" ON profiles;
CREATE POLICY "Users can view profiles in their own organization"
    ON profiles FOR SELECT TO authenticated USING (organization_id = get_auth_user_organization_id() OR id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile"
    ON profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- AUTOMATION SETTINGS POLICIES:
DROP POLICY IF EXISTS "Admins have full access to automation_settings" ON automation_settings;
CREATE POLICY "Admins have full access to automation_settings"
    ON automation_settings FOR ALL TO authenticated USING (is_brik_admin()) WITH CHECK (is_brik_admin());

DROP POLICY IF EXISTS "Clients can view their own automation_settings" ON automation_settings;
CREATE POLICY "Clients can view their own automation_settings"
    ON automation_settings FOR SELECT TO authenticated USING (organization_id = get_auth_user_organization_id());

DROP POLICY IF EXISTS "Clients can update their own automation_settings" ON automation_settings;
CREATE POLICY "Clients can update their own automation_settings"
    ON automation_settings FOR UPDATE TO authenticated USING (organization_id = get_auth_user_organization_id()) WITH CHECK (organization_id = get_auth_user_organization_id());

-- CUSTOMERS POLICIES:
DROP POLICY IF EXISTS "Admins have full access to customers" ON customers;
CREATE POLICY "Admins have full access to customers"
    ON customers FOR ALL TO authenticated USING (is_brik_admin()) WITH CHECK (is_brik_admin());

DROP POLICY IF EXISTS "Clients can view their own customers" ON customers;
CREATE POLICY "Clients can view their own customers"
    ON customers FOR SELECT TO authenticated USING (organization_id = get_auth_user_organization_id());

DROP POLICY IF EXISTS "Clients can manage their own customers" ON customers;
CREATE POLICY "Clients can manage their own customers"
    ON customers FOR ALL TO authenticated USING (organization_id = get_auth_user_organization_id()) WITH CHECK (organization_id = get_auth_user_organization_id());

-- CALLS POLICIES:
DROP POLICY IF EXISTS "Admins have full access to calls" ON calls;
CREATE POLICY "Admins have full access to calls"
    ON calls FOR ALL TO authenticated USING (is_brik_admin()) WITH CHECK (is_brik_admin());

DROP POLICY IF EXISTS "Clients can view their own calls" ON calls;
CREATE POLICY "Clients can view their own calls"
    ON calls FOR SELECT TO authenticated USING (organization_id = get_auth_user_organization_id());

-- MESSAGES POLICIES:
DROP POLICY IF EXISTS "Admins have full access to messages" ON messages;
CREATE POLICY "Admins have full access to messages"
    ON messages FOR ALL TO authenticated USING (is_brik_admin()) WITH CHECK (is_brik_admin());

DROP POLICY IF EXISTS "Clients can view their own messages" ON messages;
CREATE POLICY "Clients can view their own messages"
    ON messages FOR SELECT TO authenticated USING (organization_id = get_auth_user_organization_id());

-- LEADS POLICIES:
DROP POLICY IF EXISTS "Clients can view their own leads" ON leads;
CREATE POLICY "Clients can view their own leads"
    ON leads FOR SELECT TO authenticated USING (organization_id = get_auth_user_organization_id() OR is_brik_admin());

DROP POLICY IF EXISTS "Clients can insert their own leads" ON leads;
CREATE POLICY "Clients can insert their own leads"
    ON leads FOR INSERT TO authenticated WITH CHECK (organization_id = get_auth_user_organization_id() OR is_brik_admin());

DROP POLICY IF EXISTS "Clients can update their own leads" ON leads;
CREATE POLICY "Clients can update their own leads"
    ON leads FOR UPDATE TO authenticated USING (organization_id = get_auth_user_organization_id() OR is_brik_admin()) WITH CHECK (organization_id = get_auth_user_organization_id() OR is_brik_admin());

DROP POLICY IF EXISTS "Clients can delete their own leads" ON leads;
CREATE POLICY "Clients can delete their own leads"
    ON leads FOR DELETE TO authenticated USING (organization_id = get_auth_user_organization_id() OR is_brik_admin());

DROP POLICY IF EXISTS "Public website can submit leads" ON leads;
CREATE POLICY "Public website can submit leads"
    ON leads FOR INSERT TO anon WITH CHECK (true);

-- JOBS & REVIEWS POLICIES:
DROP POLICY IF EXISTS "Tenant isolation for jobs" ON jobs;
CREATE POLICY "Tenant isolation for jobs"
    ON jobs FOR ALL TO authenticated USING (organization_id = get_auth_user_organization_id() OR is_brik_admin()) WITH CHECK (organization_id = get_auth_user_organization_id() OR is_brik_admin());

DROP POLICY IF EXISTS "Tenant isolation for reviews" ON reviews;
CREATE POLICY "Tenant isolation for reviews"
    ON reviews FOR ALL TO authenticated USING (organization_id = get_auth_user_organization_id() OR is_brik_admin()) WITH CHECK (organization_id = get_auth_user_organization_id() OR is_brik_admin());

-- WEBHOOK LOGS POLICIES:
DROP POLICY IF EXISTS "Admins have full access to webhook_logs" ON webhook_logs;
CREATE POLICY "Admins have full access to webhook_logs"
    ON webhook_logs FOR ALL TO authenticated USING (is_brik_admin()) WITH CHECK (is_brik_admin());

DROP POLICY IF EXISTS "Clients can view their own webhook_logs" ON webhook_logs;
CREATE POLICY "Clients can view their own webhook_logs"
    ON webhook_logs FOR SELECT TO authenticated USING (organization_id = get_auth_user_organization_id());
