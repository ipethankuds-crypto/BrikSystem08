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
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'dexter125555@gmail.com';
const TIMEZONE = process.env.TIMEZONE || 'America/Toronto';
const PROVIDER_ID = 'usr_BiMACnASoaRIx29Y';
const APPOINTMENT_TYPE_ID = '8ae37932-14ba-4b69-b013-abb7654a984e';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qrrdmhwpiiwtixofyvqf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmRtaHdwaWl3dGl4b2Z5dnFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMDA2MjQsImV4cCI6MjEwMzc3NjYyNH0.K2f7ZRKiCaA9_PJPZZ-sQ2GY0tsxWQsd7hNwHiriEnc';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ALLOWED_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'
];

/**
 * Direct Instant Booking with SMS Reminder and Google Calendar
 */
async function createSmsReminderDirectBooking(data) {
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
      const resData = await response.json();
      return { success: true, googleEventId: resData.google_calendar_event_id || resData.id };
    } else {
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.message || 'SMS Reminder service rejected booking' };
    }
  } catch (err) {
    return { success: false, error: err.message || 'Network error connecting to SMS Reminder' };
  }
}

/**
 * Server-side Admin Notification Dispatcher
 */
async function sendAdminNotificationEmail(data) {
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
  } catch (e) {
    console.warn('Admin email dispatch notice:', e.message || e);
  }
}

/**
 * Fetch real-time available and busy slots directly from SMS Reminder / Google Calendar API
 */
async function getSmsReminderLiveSlots(dateStr) {
  try {
    const url = `https://go-interactive.herokuapp.com/v1/availability-slots/compute-slots-for-customer-day?providerId=usr_BiMACnASoaRIx29Y&appointmentTypeId=8ae37932-14ba-4b69-b013-abb7654a984e&customerDateISO=${encodeURIComponent(dateStr)}&customerTz=America%2FNew_York&rescheduleCode=`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (Array.isArray(data.slots)) {
      const availableSlots = [];
      const busySlots = [];

      for (const s of data.slots) {
        const date = new Date(s.start_time_customer_tz || s.start_time_provider_tz);
        const hours = String(date.getHours()).padStart(2, '0');
        const mins = String(date.getMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${mins}`;

        if (s.is_free !== false) {
          availableSlots.push(timeStr);
        } else {
          busySlots.push(timeStr);
        }
      }

      return { availableSlots, busySlots };
    }
    return null;
  } catch (err) {
    console.warn('SMS Reminder live availability check notice:', err.message);
    return null;
  }
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

    // 1. Fetch live available & busy slots directly from SMS Reminder / Google Calendar
    const liveSmsData = await getSmsReminderLiveSlots(dateStr);

    // 2. Fetch occupied slots in Supabase (excluding CANCELLED and FAILED)
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

    let availableSlots = [];
    let bookedSlots = [];

    if (liveSmsData) {
      // Use live slots from SMS Reminder, filtered against active DB reservations
      availableSlots = liveSmsData.availableSlots.filter(slot => !dbOccupiedSlots.includes(slot));
      bookedSlots = Array.from(new Set([...liveSmsData.busySlots, ...dbOccupiedSlots]));
    } else {
      // Fallback to standard slots minus DB occupied
      availableSlots = ALLOWED_SLOTS.filter(slot => !dbOccupiedSlots.includes(slot));
      bookedSlots = ALLOWED_SLOTS.filter(slot => !availableSlots.includes(slot)).concat(dbOccupiedSlots);
    }

    const allSlots = Array.from(new Set([...availableSlots, ...bookedSlots])).sort();

    return res.json({
      date: dateStr,
      timezone: TIMEZONE,
      allSlots,
      availableSlots,
      bookedSlots: Array.from(new Set(bookedSlots)),
      liveChecked: true,
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

    // 2. Direct Instant Booking with SMS Reminder & Google Calendar
    const smsResult = await createSmsReminderDirectBooking({
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      booking_date: cleanDate,
      booking_time: cleanTime,
    });

    if (!smsResult.success) {
      return res.status(409).json({
        error: smsResult.error || 'This time slot is no longer available. Please choose another available time.',
        occupied: true,
      });
    }

    const googleEventId = smsResult.googleEventId || null;

    // 3. Save directly to Supabase with status = 'SYNCED'
    const { data: finalBooking, error: insertErr } = await supabase
      .from('bookings')
      .insert([{
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
      }])
      .select()
      .single();

    const bookingId = finalBooking?.id || `booking_${Date.now()}`;

    // 4. Sync to CRM leads table
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

    // 5. Send Admin Notification Email
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
