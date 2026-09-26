process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { syncBookingToSmsReminder } from './smsReminderBot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configuration
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.GOOGLE_CALENDAR_ID || 'ipethankuds@gmail.com';
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
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      return res.status(400).json({ error: 'Valid date parameter (YYYY-MM-DD) is required.' });
    }

    const dateStr = date.trim();
    let busyRanges = [];
    const calendar = getCalendarClient();

    if (calendar) {
      try {
        const timeMin = new Date(`${dateStr}T00:00:00Z`).toISOString();
        const timeMax = new Date(`${dateStr}T23:59:59Z`).toISOString();

        const freeBusyRes = await calendar.freebusy.query({
          requestBody: {
            timeMin,
            timeMax,
            timeZone: TIMEZONE,
            items: [{ id: ADMIN_EMAIL }]
          }
        });
        busyRanges = freeBusyRes.data.calendars?.[ADMIN_EMAIL]?.busy || [];
      } catch (calErr) {
        console.warn('Calendar FreeBusy query notice:', calErr.message);
      }
    }

    // Check Supabase booked slots (exclude cancelled and failed)
    let dbOccupiedSlots = [];
    try {
      const { data: dbBookings } = await supabase
        .from('bookings')
        .select('booking_time')
        .eq('booking_date', dateStr)
        .not('status', 'in', '("CANCELLED","FAILED")');
      if (dbBookings) {
        dbOccupiedSlots = dbBookings.map(b => (b.booking_time || '').slice(0, 5));
      }
    } catch (dbErr) {
      console.warn('DB availability query notice:', dbErr.message);
    }

    const availableSlots = ALLOWED_SLOTS.filter(slotTime => {
      if (dbOccupiedSlots.includes(slotTime)) return false;

      const [h, m] = slotTime.split(':').map(Number);
      const slotStart = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
      const slotEnd = slotStart + 30 * 60 * 1000;

      const isBusy = busyRanges.some(range => {
        if (!range.start || !range.end) return false;
        const bStart = new Date(range.start).getTime();
        const bEnd = new Date(range.end).getTime();
        return slotStart < bEnd && slotEnd > bStart;
      });

      return !isBusy;
    });

    // Booked slots list
    const bookedSlots = ALLOWED_SLOTS.filter(slot => !availableSlots.includes(slot));

    return res.json({
      date: dateStr,
      calendarId: ADMIN_EMAIL,
      timezone: TIMEZONE,
      allSlots: ALLOWED_SLOTS,
      availableSlots,
      bookedSlots,
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
    const { name, email, phone, service_needed, booking_date, booking_time, duration_minutes = 30, notes = '' } = req.body || {};

    // 1. Validate required fields
    if (!name || !email || !phone || !service_needed || !booking_date || !booking_time) {
      return res.status(400).json({
        error: 'Missing required booking fields: name, email, phone, service_needed, booking_date, booking_time'
      });
    }

    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPhone = String(phone).trim();
    const cleanService = String(service_needed).trim();
    const cleanDate = String(booking_date).trim();
    const cleanTime = String(booking_time).trim();
    const cleanDuration = Number(duration_minutes) || 30;

    // Validate email format
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

    // 3. STEP 2: Create initial booking record in Supabase with status = 'PENDING'
    const { data: pendingBooking, error: insertErr } = await supabase
      .from('bookings')
      .insert([{
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        service_needed: cleanService,
        booking_date: cleanDate,
        booking_time: cleanTime,
        duration_minutes: cleanDuration,
        status: 'PENDING',
        notes: notes ? String(notes).trim() : null,
      }])
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

    // 5. Sync to CRM leads table
    try {
      await supabase.from('leads').insert([{
        name: cleanName,
        first_name: cleanName.split(' ')[0] || '',
        last_name: cleanName.split(' ').slice(1).join(' ') || '',
        email: cleanEmail,
        phone: cleanPhone,
        service_requested: cleanService,
        source: 'Website Booking Flow',
        status: 'Booked',
        notes: `Meeting scheduled on ${cleanDate} at ${cleanTime} (${TIMEZONE}). Requirements: ${cleanService}`,
      }]);
    } catch (leadErr) {
      console.warn('Lead insert warning:', leadErr.message);
    }

    // 6. Trigger Background Automation Bot (SMS Reminder + Google Calendar + Email Notification)
    syncBookingToSmsReminder({
      id: bookingId,
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      service_needed: cleanService,
      booking_date: cleanDate,
      booking_time: cleanTime,
    }).catch(err => console.error('[BOT ASYNC ERROR]', err));

    return res.status(201).json({
      success: true,
      message: 'Booking successfully confirmed and queued for calendar synchronization.',
      booking: {
        id: bookingId,
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        service_needed: cleanService,
        booking_date: cleanDate,
        booking_time: cleanTime,
        duration_minutes: cleanDuration,
        timezone: TIMEZONE,
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
  console.log(`📅 Connected to Google Calendar for: ${ADMIN_EMAIL}`);
});
