-- ==============================================================================
-- Brik Systems: Bookings & Calendar Complete Schema Migration
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. CREATE BOOKINGS TABLE
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    service_needed TEXT NOT NULL,
    booking_date DATE NOT NULL,
    booking_time VARCHAR(10) NOT NULL,
    duration_minutes INT NOT NULL DEFAULT 30,
    timezone VARCHAR(100) NOT NULL DEFAULT 'America/Toronto',
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'SYNCED', 'FAILED', 'CANCELLED'
    google_event_id VARCHAR(255),
    error_log TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure columns exist if table was already created earlier
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'timezone') THEN
        ALTER TABLE public.bookings ADD COLUMN timezone VARCHAR(100) NOT NULL DEFAULT 'America/Toronto';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'error_log') THEN
        ALTER TABLE public.bookings ADD COLUMN error_log TEXT;
    END IF;
END $$;

-- 3. PARTIAL UNIQUE INDEX (PREVENTS DOUBLE BOOKINGS AT DATABASE LEVEL)
-- Allows re-booking a slot if a previous booking was CANCELLED or FAILED.
DROP INDEX IF EXISTS public.uq_booking_slot;
CREATE UNIQUE INDEX uq_booking_slot
    ON public.bookings (booking_date, booking_time)
    WHERE (status NOT IN ('CANCELLED', 'FAILED'));

-- 4. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_bookings_date ON public.bookings (booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON public.bookings (email);

-- 5. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to prevent conflicts
DROP POLICY IF EXISTS "Allow public insert on bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow public select on bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow authenticated manage on bookings" ON public.bookings;

-- Policy 1: Allow public visitors (unauthenticated & authenticated) to create bookings
CREATE POLICY "Allow public insert on bookings"
    ON public.bookings
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Policy 2: Allow public visitors to read booking slots (needed for availability checking)
CREATE POLICY "Allow public select on bookings"
    ON public.bookings
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Policy 3: Allow public / bot updates on booking status
CREATE POLICY "Allow public update on bookings"
    ON public.bookings
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- Policy 4: Allow authenticated staff / admin / service role to manage all bookings
CREATE POLICY "Allow authenticated manage on bookings"
    ON public.bookings
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- 6. RELOAD SUPABASE POSTGREST SCHEMA CACHE
NOTIFY pgrst, 'reload schema';
