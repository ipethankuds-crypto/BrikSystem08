import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Disable TLS verification for local dev environments with proxy/AV interception
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

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

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.GOOGLE_CALENDAR_ID || 'dexter125555@gmail.com';
const TIMEZONE = process.env.TIMEZONE || 'America/Toronto';

function getGoogleCredentials() {
  let clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    try {
      const keyPath = path.join(process.cwd(), 'service-account-key.json');
      if (fs.existsSync(keyPath)) {
        const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        clientEmail = keyData.client_email;
        privateKey = keyData.private_key;
      }
    } catch (e) {
      console.warn('Could not read service-account-key.json:', e);
    }
  }
  return { clientEmail, privateKey };
}

// Helper to get Google OAuth2 Access Token from Service Account
async function getGoogleAccessToken(clientEmail: string, privateKey: string): Promise<string | null> {
  try {
    const formattedKey = privateKey.replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claimSet = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const b64ClaimSet = Buffer.from(JSON.stringify(claimSet)).toString('base64url');
    const unsignedJwt = `${b64Header}.${b64ClaimSet}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedJwt);
    signer.end();
    const signature = signer.sign(formattedKey, 'base64url');
    const signedJwt = `${unsignedJwt}.${signature}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signedJwt,
      }),
    });

    if (!tokenRes.ok) {
      console.warn('Google OAuth token error:', await tokenRes.text());
      return null;
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    return tokenData.access_token || null;
  } catch (err) {
    console.warn('Failed to obtain Google access token:', err);
    return null;
  }
}

// Create Event on Google Calendar with idempotency check
async function createGoogleCalendarEvent(booking: {
  id?: string;
  name: string;
  email: string;
  phone: string;
  service_needed: string;
  booking_date: string;
  booking_time: string;
  duration_minutes: number;
  existing_event_id?: string | null;
}): Promise<string | null> {
  // Idempotency check: if event already exists, reuse it
  if (booking.existing_event_id) {
    console.log('Reusing existing Google Calendar event ID:', booking.existing_event_id);
    return booking.existing_event_id;
  }

  const { clientEmail, privateKey } = getGoogleCredentials();
  const calendarId = ADMIN_EMAIL;

  if (!clientEmail || !privateKey) {
    console.warn('Google Calendar credentials not set.');
    return null;
  }

  const accessToken = await getGoogleAccessToken(clientEmail, privateKey);
  if (!accessToken) return null;

  try {
    const [hoursStr, minsStr] = booking.booking_time.split(':');
    const startHour = parseInt(hoursStr || '9', 10);
    const startMin = parseInt(minsStr || '0', 10);

    const startDateTime = new Date(`${booking.booking_date}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00`);
    const endDateTime = new Date(startDateTime.getTime() + (booking.duration_minutes || 30) * 60 * 1000);

    const eventPayload = {
      summary: `Appointment: ${booking.name} — Brik Systems`,
      description: [
        `Customer Name: ${booking.name}`,
        `Email: ${booking.email}`,
        `Phone: ${booking.phone}`,
        `Service Requested: ${booking.service_needed}`,
        `Timezone: ${TIMEZONE}`,
        booking.id ? `Booking Reference ID: ${booking.id}` : '',
        '----------------------------------------',
        'Booked automatically via Brik Systems Website'
      ].filter(Boolean).join('\n'),
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: TIMEZONE,
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: TIMEZONE,
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 30 },
        ],
      },
    };

    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventPayload),
    });

    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      console.log('Created Google Calendar event ID:', data.id);
      return data.id || null;
    } else {
      const errText = await res.text();
      console.warn('Google Calendar Event Create Error:', errText);
      throw new Error(`Google Calendar API error: ${errText}`);
    }
  } catch (e: any) {
    console.error('Google Calendar API exception:', e.message || e);
    throw e;
  }
}

// Server-side Email Dispatcher
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
  const subject = `New Website Booking — ${data.name}`;
  
  // Format body for email
  const emailPayload = {
    _subject: subject,
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
    google_calendar_event_id: data.google_event_id || 'Pending sync',
  };

  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(ADMIN_EMAIL)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Origin': 'https://briksystem000.vercel.app',
        'Referer': 'https://briksystem000.vercel.app/'
      },
      body: JSON.stringify(emailPayload),
    });
    if (!res.ok) {
      console.warn('FormSubmit notification response not ok:', await res.text());
    }
  } catch (e: any) {
    console.warn('Admin email dispatch notice:', e.message || e);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
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

  // GET /api/bookings (Admin list)
  if (req.method === 'GET') {
    try {
      const { data: bookings, error } = await supabase
        .from('bookings')
        .select('*')
        .order('booking_date', { ascending: true })
        .order('booking_time', { ascending: true });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ bookings: bookings || [] });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  // POST /api/bookings (Create & Process booking)
  if (req.method === 'POST') {
    try {
      const { name, email, phone, service_needed, booking_date, booking_time, duration_minutes = 30, notes = '' } = req.body || {};

      // 1. Validate required fields
      if (!name || !email || !phone || !service_needed || !booking_date || !booking_time) {
        return res.status(400).json({
          error: 'Missing required booking fields: name, email, phone, service_needed, booking_date, booking_time.'
        });
      }

      const cleanName = String(name).trim();
      const cleanEmail = String(email).trim().toLowerCase();
      const cleanPhone = String(phone).trim();
      const cleanService = String(service_needed).trim();
      const cleanDate = String(booking_date).trim();
      const cleanTime = String(booking_time).trim();
      const cleanDuration = Number(duration_minutes) || 30;

      // Basic email regex
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ error: 'Please provide a valid email address.' });
      }

      // 2. Pre-check for duplicate slot in Supabase
      const { data: existingSlots } = await supabase
        .from('bookings')
        .select('id, status')
        .eq('booking_date', cleanDate)
        .eq('booking_time', cleanTime)
        .not('status', 'in', '("CANCELLED","FAILED")');

      if (existingSlots && existingSlots.length > 0) {
        return res.status(409).json({
          error: 'This time slot has already been booked. Please choose another available time.',
          occupied: true,
        });
      }

      // 3. STEP 2: Create initial booking record with status = 'PENDING'
      const { data: pendingBooking, error: insertErr } = await supabase
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
            status: 'PENDING',
            notes: notes ? String(notes).trim() : null,
          },
        ])
        .select()
        .single();

      if (insertErr) {
        if (insertErr.code === '23505') {
          return res.status(409).json({
            error: 'This time slot was just booked by another customer. Please choose a different time.',
            occupied: true,
          });
        }
        console.error('Supabase booking insert error:', insertErr);
        return res.status(500).json({ error: 'Failed to create booking in database.' });
      }

      const bookingId = pendingBooking.id;

      // 4. Update status to 'PROCESSING'
      await supabase
        .from('bookings')
        .update({ status: 'PROCESSING', updated_at: new Date().toISOString() })
        .eq('id', bookingId);

      // 5. Also sync to CRM leads table
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

      // 6. STEP 4: Create Google Calendar event on server-side
      let googleEventId: string | null = null;
      try {
        googleEventId = await createGoogleCalendarEvent({
          id: bookingId,
          name: cleanName,
          email: cleanEmail,
          phone: cleanPhone,
          service_needed: cleanService,
          booking_date: cleanDate,
          booking_time: cleanTime,
          duration_minutes: cleanDuration,
          existing_event_id: pendingBooking.google_event_id,
        });
      } catch (gcalErr: any) {
        console.error('Google Calendar creation failed:', gcalErr.message || gcalErr);
        
        // Mark status as 'FAILED' in Supabase
        await supabase
          .from('bookings')
          .update({
            status: 'FAILED',
            notes: notes ? `${notes} | Error: ${gcalErr.message}` : `Error: ${gcalErr.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', bookingId);

        return res.status(500).json({
          error: 'Could not synchronize appointment with Google Calendar. Please try again or contact us directly.',
          bookingId,
        });
      }

      // 7. STEP 6: Dispatch notification email to admin
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

      // 8. STEP 9: Mark booking as 'SYNCED'
      const { data: finalBooking, error: updateErr } = await supabase
        .from('bookings')
        .update({
          status: 'SYNCED',
          google_event_id: googleEventId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bookingId)
        .select()
        .single();

      if (updateErr) {
        console.warn('Final status update warning:', updateErr);
      }

      return res.status(201).json({
        success: true,
        message: 'Booking successfully confirmed and synchronized with Google Calendar.',
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
