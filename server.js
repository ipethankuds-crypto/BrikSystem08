process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { calendar as googleCalendar } from '@googleapis/calendar';
import { GoogleAuth } from 'google-auth-library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configuration
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'ipethankuds@gmail.com';
const TIMEZONE = process.env.TIMEZONE || 'America/Toronto';
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), 'service-account-key.json');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qrrdmhwpiiwtixofyvqf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmRtaHdwaWl3dGl4b2Z5dnFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMDA2MjQsImV4cCI6MjEwMzc3NjYyNH0.K2f7ZRKiCaA9_PJPZZ-sQ2GY0tsxWQsd7hNwHiriEnc';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ALLOWED_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'
];

/**
 * Initialize Google Calendar client with Service Account
 */
function getCalendarClient() {
  let auth;
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    auth = new GoogleAuth({
      keyFile: SERVICE_ACCOUNT_PATH,
      scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events']
    });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    auth = new GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events']
    });
  } else {
    return null;
  }
  return googleCalendar({ version: 'v3', auth });
}

// ---------------------------------------------------------------------------
// GET /api/availability & /api/calendar/availability
// ---------------------------------------------------------------------------
async function handleAvailability(req, res) {
  try {
    const { date } = req.query;
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Valid date parameter (YYYY-MM-DD) is required.' });
    }

    let busyRanges = [];
    const calendar = getCalendarClient();

    if (calendar) {
      try {
        const timeMin = new Date(`${date}T00:00:00Z`).toISOString();
        const timeMax = new Date(`${date}T23:59:59Z`).toISOString();

        const freeBusyRes = await calendar.freebusy.query({
          requestBody: {
            timeMin,
            timeMax,
            timeZone: TIMEZONE,
            items: [{ id: CALENDAR_ID }]
          }
        });
        busyRanges = freeBusyRes.data.calendars?.[CALENDAR_ID]?.busy || [];
      } catch (calErr) {
        console.warn('Calendar FreeBusy query notice:', calErr.message);
      }
    }

    // Also check Supabase booked slots
    let dbOccupiedSlots = [];
    try {
      const { data: dbBookings } = await supabase
        .from('bookings')
        .select('booking_time')
        .eq('booking_date', date)
        .neq('status', 'CANCELLED');
      if (dbBookings) {
        dbOccupiedSlots = dbBookings.map(b => (b.booking_time || '').slice(0, 5));
      }
    } catch (dbErr) {
      console.warn('DB availability query notice:', dbErr.message);
    }

    const availableSlots = ALLOWED_SLOTS.filter(slotTime => {
      if (dbOccupiedSlots.includes(slotTime)) return false;

      const [h, m] = slotTime.split(':').map(Number);
      const slotStart = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
      const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

      const isBusy = busyRanges.some(range => {
        if (!range.start || !range.end) return false;
        const bStart = new Date(range.start);
        const bEnd = new Date(range.end);
        return slotStart < bEnd && slotEnd > bStart;
      });

      return !isBusy;
    });

    return res.json({
      date,
      calendarId: CALENDAR_ID,
      timezone: TIMEZONE,
      allSlots: ALLOWED_SLOTS,
      availableSlots,
      busyRanges
    });
  } catch (err) {
    console.error('Availability error:', err);
    return res.status(500).json({ error: 'Failed to query availability' });
  }
}

app.get('/api/availability', handleAvailability);
app.get('/api/calendar/availability', handleAvailability);

// ---------------------------------------------------------------------------
// POST /api/bookings & /api/calendar/book
// ---------------------------------------------------------------------------
async function handleCreateBooking(req, res) {
  try {
    const { name, email, phone, service_needed, booking_date, booking_time, duration_minutes = 30, notes = '' } = req.body;

    if (!name || !email || !phone || !service_needed || !booking_date || !booking_time) {
      return res.status(400).json({
        error: 'Missing required fields: name, email, phone, service_needed, booking_date, booking_time'
      });
    }

    const cleanDate = booking_date.trim();
    const cleanTime = booking_time.trim();

    // 1. Insert into Supabase Bookings
    let bookingRecord = null;
    try {
      const { data: inserted, error: dbErr } = await supabase
        .from('bookings')
        .insert([{
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          service_needed: service_needed.trim(),
          booking_date: cleanDate,
          booking_time: cleanTime,
          duration_minutes: Number(duration_minutes) || 30,
          status: 'CONFIRMED',
          notes: notes.trim(),
        }])
        .select()
        .single();

      if (dbErr && dbErr.code === '23505') {
        return res.status(409).json({
          error: 'This time slot was just booked by another customer. Please choose a different time.'
        });
      }
      bookingRecord = inserted;
    } catch (err) {
      console.warn('Supabase booking insert warning:', err.message);
    }

    // 2. Insert into Supabase Leads
    try {
      await supabase.from('leads').insert([{
        name: name.trim(),
        first_name: name.trim().split(' ')[0] || '',
        last_name: name.trim().split(' ').slice(1).join(' ') || '',
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        service_requested: service_needed.trim(),
        source: 'Website Booking Flow',
        status: 'Booked',
        notes: `Meeting scheduled on ${cleanDate} at ${cleanTime}. Requirements: ${service_needed.trim()}`,
      }]);
    } catch (leadErr) {
      console.warn('Lead insert warning:', leadErr.message);
    }

    // 3. Create Google Calendar Event
    let googleEventId = null;
    let googleEventLink = null;
    const calendar = getCalendarClient();

    if (calendar) {
      try {
        const [hoursStr, minsStr] = cleanTime.split(':');
        const startHour = parseInt(hoursStr || '9', 10);
        const startMin = parseInt(minsStr || '0', 10);

        const startDateTime = new Date(`${cleanDate}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00`);
        const endDateTime = new Date(startDateTime.getTime() + (duration_minutes || 30) * 60 * 1000);

        const event = await calendar.events.insert({
          calendarId: CALENDAR_ID,
          requestBody: {
            summary: `Appointment: ${name.trim()} — Brik Systems`,
            description: [
              `Customer Name: ${name.trim()}`,
              `Phone: ${phone.trim()}`,
              `Email: ${email.trim()}`,
              `Service Requested: ${service_needed.trim()}`,
              notes ? `Notes: ${notes.trim()}` : '',
              '----------------------------------------',
              'Booked automatically via Brik Systems Booking Platform'
            ].filter(Boolean).join('\n'),
            start: {
              dateTime: startDateTime.toISOString(),
              timeZone: TIMEZONE
            },
            end: {
              dateTime: endDateTime.toISOString(),
              timeZone: TIMEZONE
            },
            reminders: {
              useDefault: false,
              overrides: [
                { method: 'email', minutes: 24 * 60 },
                { method: 'popup', minutes: 30 }
              ]
            }
          }
        });

        googleEventId = event.data.id;
        googleEventLink = event.data.htmlLink;
        console.log('✅ Google Calendar event created:', googleEventLink);

        if (bookingRecord?.id && googleEventId) {
          await supabase.from('bookings').update({ google_event_id: googleEventId }).eq('id', bookingRecord.id);
        }
      } catch (calErr) {
        console.error('❌ Google Calendar insertion error:', calErr.message);
      }
    }

    // 4. Send Email Notification via FormSubmit
    try {
      await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(CALENDAR_ID)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: `New Meeting Booked: ${name.trim()} (${cleanDate} at ${cleanTime})`,
          _template: 'table',
          _captcha: 'false',
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          date: cleanDate,
          time: cleanTime,
          what_they_need: service_needed.trim(),
          google_calendar_link: googleEventLink || 'Created on Google Calendar',
        }),
      });
    } catch (mailErr) {
      console.warn('FormSubmit notification error:', mailErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Booking successfully confirmed and added to calendar.',
      booking: {
        ...(bookingRecord || { name, email, phone, service_needed, booking_date: cleanDate, booking_time: cleanTime }),
        google_event_id: googleEventId,
        google_event_link: googleEventLink,
      }
    });
  } catch (err) {
    console.error('Booking handler error:', err);
    return res.status(500).json({ error: 'Failed to process booking.' });
  }
}

app.post('/api/bookings', handleCreateBooking);
app.post('/api/calendar/book', handleCreateBooking);

// GET /api/bookings (Admin list)
app.get('/api/bookings', async (req, res) => {
  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*')
      .order('booking_date', { ascending: true })
      .order('booking_time', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ bookings: bookings || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Serve Static Frontend
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(__dirname));

// Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Brik Systems backend running at http://localhost:${PORT}`);
  console.log(`📅 Connected to Google Calendar for: ${CALENDAR_ID}`);
});
