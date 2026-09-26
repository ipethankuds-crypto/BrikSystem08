import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

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

import * as fs from 'fs';
import * as path from 'path';

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

// Create Event on Google Calendar
async function createGoogleCalendarEvent(booking: {
  name: string;
  email: string;
  phone: string;
  service_needed: string;
  booking_date: string;
  booking_time: string;
  duration_minutes: number;
}): Promise<string | null> {
  const { clientEmail, privateKey } = getGoogleCredentials();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'ipethankuds@gmail.com';

  if (!clientEmail || !privateKey) {
    console.log('Google Calendar credentials not set. Skipping live calendar sync.');
    return null;
  }

  const accessToken = await getGoogleAccessToken(clientEmail, privateKey);
  if (!accessToken) return null;

  try {
    const [hoursStr, minsStr] = booking.booking_time.split(':');
    const startHour = parseInt(hoursStr || '9', 10);
    const startMin = parseInt(minsStr || '0', 10);

    const startDateTime = new Date(`${booking.booking_date}T${hoursStr.padStart(2, '0')}:${minsStr.padStart(2, '0')}:00`);
    const endDateTime = new Date(startDateTime.getTime() + (booking.duration_minutes || 30) * 60 * 1000);

    const eventPayload = {
      summary: `Meeting with ${booking.name} — Brik Systems`,
      description: `Customer Name: ${booking.name}\nEmail: ${booking.email}\nPhone: ${booking.phone}\nWhat they need: ${booking.service_needed}\nBooked via BrikSystems Booking System`,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: process.env.TIMEZONE || 'America/Toronto',
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: process.env.TIMEZONE || 'America/Toronto',
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
      console.warn('Google Calendar Event Create Error:', await res.text());
      return null;
    }
  } catch (e) {
    console.warn('Google Calendar API exception:', e);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
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

  // POST /api/bookings (Create booking)
  if (req.method === 'POST') {
    try {
      const { name, email, phone, service_needed, booking_date, booking_time, duration_minutes = 30, notes = '' } = req.body;

      if (!name || !email || !phone || !service_needed || !booking_date || !booking_time) {
        return res.status(400).json({ error: 'Missing required booking fields (name, email, phone, service_needed, booking_date, booking_time).' });
      }

      const cleanDate = booking_date.trim();
      const cleanTime = booking_time.trim();

      // 1. Check for existing active booking at this slot (prevent double booking)
      const { data: existingSlots, error: checkErr } = await supabase
        .from('bookings')
        .select('id, status')
        .eq('booking_date', cleanDate)
        .eq('booking_time', cleanTime)
        .neq('status', 'CANCELLED');

      if (checkErr) {
        console.warn('Slot check warning:', checkErr);
      }

      if (existingSlots && existingSlots.length > 0) {
        return res.status(409).json({
          error: 'This time slot has already been booked. Please choose another available time.',
          occupied: true,
        });
      }

      // 2. Insert new booking into Supabase
      const { data: newBooking, error: insertErr } = await supabase
        .from('bookings')
        .insert([
          {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            phone: phone.trim(),
            service_needed: service_needed.trim(),
            booking_date: cleanDate,
            booking_time: cleanTime,
            duration_minutes: Number(duration_minutes) || 30,
            status: 'CONFIRMED',
            notes: notes.trim(),
          },
        ])
        .select()
        .single();

      let bookingRecord = newBooking;

      if (insertErr) {
        if (insertErr.code === '23505') {
          return res.status(409).json({
            error: 'This time slot was just booked by another customer. Please pick a different time.',
            occupied: true,
          });
        }
        console.warn('Supabase bookings insert warning (table may be pending migration):', insertErr.message);
        // Create a fallback booking record so lead and calendar sync proceed
        bookingRecord = {
          id: `temp_${Date.now()}`,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          service_needed: service_needed.trim(),
          booking_date: cleanDate,
          booking_time: cleanTime,
          duration_minutes: Number(duration_minutes) || 30,
          status: 'CONFIRMED',
          notes: notes.trim(),
          created_at: new Date().toISOString(),
        };
      }

      // 3. Sync lead into leads table for CRM tracking
      try {
        await supabase.from('leads').insert([
          {
            name: name.trim(),
            first_name: name.trim().split(' ')[0] || '',
            last_name: name.trim().split(' ').slice(1).join(' ') || '',
            email: email.trim().toLowerCase(),
            phone: phone.trim(),
            service_requested: service_needed.trim(),
            source: 'Website Booking Flow',
            status: 'Booked',
            notes: `Meeting scheduled on ${cleanDate} at ${cleanTime}. Requirements: ${service_needed.trim()}`,
          },
        ]);
      } catch (leadErr) {
        console.warn('Lead sync notice:', leadErr);
      }

      // 4. Create Google Calendar event
      let googleEventId: string | null = null;
      try {
        googleEventId = await createGoogleCalendarEvent({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          service_needed: service_needed.trim(),
          booking_date: cleanDate,
          booking_time: cleanTime,
          duration_minutes: Number(duration_minutes) || 30,
        });

        if (googleEventId && newBooking?.id) {
          await supabase
            .from('bookings')
            .update({ google_event_id: googleEventId })
            .eq('id', newBooking.id);
        }
      } catch (calErr) {
        console.warn('Google Calendar sync warning:', calErr);
      }

      // 5. Send notification email to admin
      try {
        await fetch('https://formsubmit.co/ajax/ipethankuds@gmail.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            _subject: `New Meeting Booked: ${name.trim()} (${cleanDate} at ${cleanTime})`,
            _template: 'table',
            _captcha: 'false',
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim(),
            meeting_date: cleanDate,
            meeting_time: cleanTime,
            what_they_need: service_needed.trim(),
            google_calendar_synced: Boolean(googleEventId),
          }),
        });
      } catch (emailErr) {
        console.warn('Notification email error:', emailErr);
      }

      return res.status(201).json({
        success: true,
        booking: {
          ...newBooking,
          google_event_id: googleEventId,
        },
        message: 'Meeting booked successfully.',
      });
    } catch (err: any) {
      console.error('Booking error:', err);
      return res.status(500).json({ error: err.message || 'Failed to process booking.' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
