import express from 'express';
import { calendar as googleCalendar } from '@googleapis/calendar';
import { GoogleAuth } from 'google-auth-library';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configuration
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'ipethankuds@gmail.com';
const TIMEZONE = process.env.TIMEZONE || 'America/Toronto';
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), 'service-account-key.json');

// Allowed 30-minute booking windows: 9am - 12pm and 3pm - 6pm
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
    throw new Error(`Google service account key not found at: ${SERVICE_ACCOUNT_PATH} and env credentials missing.`);
  }

  return googleCalendar({ version: 'v3', auth });
}

/**
 * GET /api/calendar/availability?date=YYYY-MM-DD
 * Fetches busy intervals from Google Calendar and returns available appointment slots.
 */
router.get('/availability', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Valid date parameter (YYYY-MM-DD) is required.' });
    }

    const calendar = getCalendarClient();

    // Query entire day in UTC bounds
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

    const busyRanges = freeBusyRes.data.calendars?.[CALENDAR_ID]?.busy || [];

    // Filter available slots against Google Calendar busy periods
    const availableSlots = ALLOWED_SLOTS.filter(slotTime => {
      const [h, m] = slotTime.split(':').map(Number);
      
      // Slot start & end in local time converted to Date
      const slotStart = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
      const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

      // Check if slot overlaps with any busy range
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
  } catch (error) {
    console.error('Error fetching calendar availability:', error);
    return res.status(500).json({
      error: 'Failed to query calendar availability',
      details: error.message
    });
  }
});

/**
 * POST /api/calendar/book
 * Inserts a new confirmed booking event into Google Calendar.
 */
router.post('/book', async (req, res) => {
  try {
    const { name, email, phone, service_needed, booking_date, booking_time, duration_minutes = 30, notes = '' } = req.body;

    if (!name || !email || !phone || !service_needed || !booking_date || !booking_time) {
      return res.status(400).json({
        error: 'Missing required fields: name, email, phone, service_needed, booking_date, booking_time'
      });
    }

    const calendar = getCalendarClient();

    const [hoursStr, minsStr] = booking_time.split(':');
    const startHour = parseInt(hoursStr || '9', 10);
    const startMin = parseInt(minsStr || '0', 10);

    const startDateTime = new Date(`${booking_date}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00`);
    const endDateTime = new Date(startDateTime.getTime() + duration_minutes * 60 * 1000);

    // Double check if slot is still free before inserting
    const conflictCheck = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDateTime.toISOString(),
        timeMax: endDateTime.toISOString(),
        timeZone: TIMEZONE,
        items: [{ id: CALENDAR_ID }]
      }
    });

    const isOccupied = (conflictCheck.data.calendars?.[CALENDAR_ID]?.busy || []).length > 0;
    if (isOccupied) {
      return res.status(409).json({
        error: 'This time slot is no longer available on Google Calendar. Please choose another time.'
      });
    }

    // Create Google Calendar event
    const event = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `Appointment: ${name} — Brik Systems`,
        description: [
          `Customer Name: ${name}`,
          `Phone: ${phone}`,
          `Email: ${email}`,
          `Service Requested: ${service_needed}`,
          notes ? `Notes: ${notes}` : '',
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
            { method: 'email', minutes: 24 * 60 }, // 1 day before
            { method: 'popup', minutes: 30 }       // 30 mins before
          ]
        }
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Booking event created on Google Calendar',
      eventId: event.data.id,
      htmlLink: event.data.htmlLink,
      start: event.data.start,
      end: event.data.end
    });
  } catch (error) {
    console.error('Error inserting Google Calendar booking event:', error);
    return res.status(500).json({
      error: 'Failed to create Google Calendar event',
      details: error.message
    });
  }
});

export default router;
