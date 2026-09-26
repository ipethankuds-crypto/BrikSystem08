import { createClient } from '@supabase/supabase-js';

export interface VercelRequest {
  method?: string;
  body?: any;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
}

export interface VercelResponse {
  setHeader(name: string, value: string): this;
  status(code: number): this;
  json(body: any): this;
  end(): this;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qrrdmhwpiiwtixofyvqf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmRtaHdwaWl3dGl4b2Z5dnFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMDA2MjQsImV4cCI6MjEwMzc3NjYyNH0.K2f7ZRKiCaA9_PJPZZ-sQ2GY0tsxWQsd7hNwHiriEnc';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TIMEZONE = process.env.TIMEZONE || 'America/Toronto';

const ALLOWED_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'
];

/**
 * Fetch real-time available slots directly from SMS Reminder / Google Calendar API
 */
async function getSmsReminderLiveSlots(dateStr: string): Promise<string[] | null> {
  try {
    const url = `https://go-interactive.herokuapp.com/v1/availability-slots/compute-slots-for-customer-day?providerId=usr_BiMACnASoaRIx29Y&appointmentTypeId=8ae37932-14ba-4b69-b013-abb7654a984e&customerDateISO=${encodeURIComponent(dateStr)}&customerTz=America%2FNew_York&rescheduleCode=`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json() as { slots?: Array<{ start_time_customer_tz?: string; start_time_provider_tz?: string }> };
    if (Array.isArray(data.slots)) {
      return data.slots.map(s => {
        const date = new Date(s.start_time_customer_tz || s.start_time_provider_tz || '');
        const hours = String(date.getHours()).padStart(2, '0');
        const mins = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${mins}`;
      });
    }
    return null;
  } catch (err: any) {
    console.warn('SMS Reminder live availability check notice:', err.message || err);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { date } = req.query;

    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      return res.status(400).json({ error: 'Date query parameter is required in YYYY-MM-DD format.' });
    }

    const dateStr = date.trim();

    // 1. Fetch live available slots directly from SMS Reminder / Google Calendar
    const liveSmsSlots = await getSmsReminderLiveSlots(dateStr);

    // 2. Fetch active bookings from Supabase (excluding CANCELLED and FAILED)
    let dbOccupiedSlots: string[] = [];
    try {
      const { data: dbBookings, error: dbError } = await supabase
        .from('bookings')
        .select('booking_time')
        .eq('booking_date', dateStr)
        .not('status', 'in', '("CANCELLED","FAILED")');

      if (dbBookings) {
        dbOccupiedSlots = dbBookings.map((b) => (b.booking_time || '').slice(0, 5));
      }
    } catch (dbErr) {
      console.warn('Supabase availability query error:', dbErr);
    }

    let availableSlots: string[] = [];
    if (liveSmsSlots && liveSmsSlots.length > 0) {
      availableSlots = liveSmsSlots.filter(slot => !dbOccupiedSlots.includes(slot));
    } else {
      availableSlots = ALLOWED_SLOTS.filter(slot => !dbOccupiedSlots.includes(slot));
    }

    const baseSlots = liveSmsSlots || ALLOWED_SLOTS;
    const bookedSlots = Array.from(new Set(baseSlots.filter(slot => !availableSlots.includes(slot)).concat(dbOccupiedSlots)));

    return res.status(200).json({
      date: dateStr,
      timezone: TIMEZONE,
      allSlots: baseSlots,
      availableSlots,
      bookedSlots,
      liveChecked: true,
    });
  } catch (err: any) {
    console.error('Availability error:', err);
    return res.status(500).json({ error: err.message || 'Failed to check availability.' });
  }
}
