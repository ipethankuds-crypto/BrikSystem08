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

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.GOOGLE_CALENDAR_ID || 'ipethankuds@gmail.com';
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
      scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar',
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
      console.warn('Google OAuth token error in availability:', await tokenRes.text());
      return null;
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    return tokenData.access_token || null;
  } catch (err) {
    console.warn('Failed to obtain Google access token for availability:', err);
    return null;
  }
}

// Check Google Calendar FreeBusy
async function getGoogleBusySlots(dateStr: string): Promise<string[]> {
  const { clientEmail, privateKey } = getGoogleCredentials();
  const calendarId = ADMIN_EMAIL;
  const timezone = TIMEZONE;

  if (!clientEmail || !privateKey) {
    return [];
  }

  const accessToken = await getGoogleAccessToken(clientEmail, privateKey);
  if (!accessToken) return [];

  try {
    const timeMin = new Date(`${dateStr}T00:00:00Z`).toISOString();
    const timeMax = new Date(`${dateStr}T23:59:59Z`).toISOString();

    const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        timeZone: timezone,
        items: [{ id: calendarId }],
      }),
    });

    if (!freeBusyRes.ok) {
      console.warn('Google FreeBusy error:', await freeBusyRes.text());
      return [];
    }

    const data = (await freeBusyRes.json()) as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
    };

    const busyRanges = data.calendars?.[calendarId]?.busy || [];
    const busySlots: string[] = [];

    // Allowed consultation slots: 9am - 12pm and 3pm - 6pm (30 min increments)
    const possibleSlots = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'
    ];

    for (const slot of possibleSlots) {
      const [h, m] = slot.split(':').map(Number);
      const slotStart = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
      const slotEnd = slotStart + 30 * 60 * 1000;

      for (const range of busyRanges) {
        if (!range.start || !range.end) continue;
        const busyStart = new Date(range.start).getTime();
        const busyEnd = new Date(range.end).getTime();

        // Check if slot overlaps with busy interval
        if (slotStart < busyEnd && slotEnd > busyStart) {
          busySlots.push(slot);
          break;
        }
      }
    }

    return busySlots;
  } catch (err) {
    console.warn('Google FreeBusy check exception:', err);
    return [];
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

    // 1. Fetch active bookings from Supabase (excluding cancelled and failed)
    const { data: dbBookings, error: dbError } = await supabase
      .from('bookings')
      .select('booking_time')
      .eq('booking_date', dateStr)
      .not('status', 'in', '("CANCELLED","FAILED")');

    if (dbError) {
      console.warn('Supabase availability query error:', dbError);
    }

    const dbOccupied = (dbBookings || []).map((b) => (b.booking_time || '').slice(0, 5));

    // 2. Fetch occupied slots from Google Calendar
    const googleOccupied = await getGoogleBusySlots(dateStr);

    // 3. Merge and deduplicate
    const occupiedSet = new Set<string>([...dbOccupied, ...googleOccupied]);
    const bookedSlots = Array.from(occupiedSet).sort();

    return res.status(200).json({
      date: dateStr,
      timezone: TIMEZONE,
      bookedSlots,
      googleCalendarChecked: true,
    });
  } catch (err: any) {
    console.error('Availability error:', err);
    return res.status(500).json({ error: err.message || 'Failed to check availability.' });
  }
}
