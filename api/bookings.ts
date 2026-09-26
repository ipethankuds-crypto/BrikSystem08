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

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'dexter125555@gmail.com';
const TIMEZONE = process.env.TIMEZONE || 'America/Toronto';
const PROVIDER_ID = 'usr_BiMACnASoaRIx29Y';
const APPOINTMENT_TYPE_ID = '8ae37932-14ba-4b69-b013-abb7654a984e';

/**
 * Direct Instant Booking with SMS Reminder and Google Calendar
 */
async function createSmsReminderDirectBooking(data: {
  name: string;
  email: string;
  phone: string;
  booking_date: string;
  booking_time: string;
}): Promise<{ success: boolean; googleEventId?: string | null; error?: string }> {
  try {
    let cleanPhone = data.phone.replace(/[^\d+]/g, '');
    if (!cleanPhone.startsWith('+')) {
      cleanPhone = '+1' + cleanPhone.replace(/^1/, '');
    }

    const [h, m] = data.booking_time.split(':').map(Number);
    // Provider timezone is America/New_York (UTC-4)
    const startTimeUtc = new Date(`${data.booking_date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`).toISOString();

    const response = await fetch('https://go-interactive.herokuapp.com/v1/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://www.smsreminder.co/',
        'Origin': 'https://www.smsreminder.co',
      },
      body: JSON.stringify({
        booking_source: 'web',
        provider_id: PROVIDER_ID,
        appointment_type_id: APPOINTMENT_TYPE_ID,
        start_time_utc: startTimeUtc,
        customer_name: data.name,
        customer_phone: cleanPhone,
        customer_email: data.email,
        customer_tz: 'America/New_York',
      }),
    });

    if (response.ok) {
      const resData = await response.json() as { id?: string; google_calendar_event_id?: string };
      return { success: true, googleEventId: resData.google_calendar_event_id || resData.id };
    } else {
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.message || 'SMS Reminder service rejected booking' };
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error connecting to SMS Reminder' };
  }
}

/**
 * Server-side Admin Notification Dispatcher
 */
async function sendAdminNotificationEmail(data: {
  bookingId: string;
  name: string;
  email: string;
  phone: string;
  service_needed: string;
  booking_date: string;
  booking_time: string;
  google_event_id?: string | null;
}) {
  const emailPayload = {
    _subject: `New Website Booking — ${data.name}`,
    _template: 'table',
    _captcha: 'false',
    customer_name: data.name,
    customer_email: data.email,
    customer_phone: data.phone,
    booking_date: data.booking_date,
    booking_time: data.booking_time,
    timezone: TIMEZONE,
    service_topic: data.service_needed,
    booking_id: data.bookingId,
    google_calendar_sync: data.google_event_id ? `CONFIRMED (Event ID: ${data.google_event_id})` : 'Synced via SMS Reminder',
  };

  try {
    await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(ADMIN_EMAIL)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Origin': 'https://briksystem000.vercel.app',
        'Referer': 'https://briksystem000.vercel.app/',
      },
      body: JSON.stringify(emailPayload),
    });
  } catch (e: any) {
    console.warn('Admin email dispatch notice:', e.message || e);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const { name, email, phone, service_needed, booking_date, booking_time, duration_minutes = 30, notes = '' } = req.body || {};

      if (!name || !email || !phone || !service_needed || !booking_date || !booking_time) {
        return res.status(400).json({
          error: 'Missing required booking fields: name, email, phone, service_needed, booking_date, booking_time.',
        });
      }

      const cleanName = String(name).trim();
      const cleanEmail = String(email).trim().toLowerCase();
      const cleanPhone = String(phone).trim();
      const cleanService = String(service_needed).trim();
      const cleanDate = String(booking_date).trim();
      const cleanTime = String(booking_time).trim();
      const cleanDuration = Number(duration_minutes) || 30;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ error: 'Please provide a valid email address.' });
      }

      // 1. Direct Instant Booking with SMS Reminder & Google Calendar
      const smsResult = await createSmsReminderDirectBooking({
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        booking_date: cleanDate,
        booking_time: cleanTime,
      });

      if (!smsResult.success) {
        return res.status(409).json({
          error: smsResult.error || 'This time slot is no longer available. Please select another time.',
          occupied: true,
        });
      }

      const googleEventId = smsResult.googleEventId || null;

      // 2. Save directly to Supabase with status = 'SYNCED'
      const { data: finalBooking, error: insertErr } = await supabase
        .from('bookings')
        .insert([
          {
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            service_needed: cleanService,
            booking_date: cleanDate,
            booking_time: cleanTime,
            duration_minutes: cleanDuration,
            status: 'SYNCED',
            google_event_id: googleEventId,
            notes: notes ? String(notes).trim() : null,
          },
        ])
        .select()
        .single();

      const bookingId = finalBooking?.id || `booking_${Date.now()}`;

      // 3. Sync to CRM Leads table
      try {
        await supabase.from('leads').insert([
          {
            name: cleanName,
            first_name: cleanName.split(' ')[0] || '',
            last_name: cleanName.split(' ').slice(1).join(' ') || '',
            email: cleanEmail,
            phone: cleanPhone,
            service_requested: cleanService,
            source: 'Website Booking Flow',
            status: 'Booked',
            notes: `Meeting scheduled on ${cleanDate} at ${cleanTime} (${TIMEZONE}). Topics: ${cleanService}`,
          },
        ]);
      } catch (leadErr: any) {
        console.warn('Lead CRM sync notice:', leadErr.message || leadErr);
      }

      // 4. Dispatch Email to Dexter
      await sendAdminNotificationEmail({
        bookingId,
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        service_needed: cleanService,
        booking_date: cleanDate,
        booking_time: cleanTime,
        google_event_id: googleEventId,
      });

      return res.status(201).json({
        success: true,
        message: 'Booking successfully confirmed and added to Google Calendar.',
        booking: finalBooking || {
          id: bookingId,
          name: cleanName,
          email: cleanEmail,
          phone: cleanPhone,
          service_needed: cleanService,
          booking_date: cleanDate,
          booking_time: cleanTime,
          duration_minutes: cleanDuration,
          timezone: TIMEZONE,
          status: 'SYNCED',
          google_event_id: googleEventId,
        },
      });
    } catch (err: any) {
      console.error('Booking processing exception:', err);
      return res.status(500).json({ error: err.message || 'An unexpected error occurred processing your booking.' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
