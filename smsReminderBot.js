process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qrrdmhwpiiwtixofyvqf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmRtaHdwaWl3dGl4b2Z5dnFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMDA2MjQsImV4cCI6MjEwMzc3NjYyNH0.K2f7ZRKiCaA9_PJPZZ-sQ2GY0tsxWQsd7hNwHiriEnc';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'dexter125555@gmail.com';
const SMS_REMINDER_URL = 'https://www.smsreminder.co/book/007UCqZnjYgVb4dI/ipethan-kuds';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function getBrowserPath() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (fs.existsSync(chromePath)) return chromePath;
  if (fs.existsSync(edgePath)) return edgePath;
  return undefined;
}

function formatTimeTo12Hour(timeStr) {
  if (!timeStr) return '10:00 AM';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

/**
 * Automate filling the SMS Reminder booking page for a single booking record
 */
export async function syncBookingToSmsReminder(booking) {
  console.log(`\n🤖 [BOT] Processing booking #${booking.id} for ${booking.name}...`);
  const execPath = getBrowserPath();

  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(40000);

  try {
    // 1. Navigate to SMS Reminder Page
    console.log(`[BOT] Navigating to SMS Reminder page...`);
    await page.goto(SMS_REMINDER_URL, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2000));

    // Parse target date
    const [year, month, day] = booking.booking_date.split('-').map(Number);
    const targetDayStr = String(day);
    const targetTime12 = formatTimeTo12Hour(booking.booking_time);

    console.log(`[BOT] Target Slot: Day ${targetDayStr} at ${targetTime12}`);

    // 2. Select Date on Calendar (if not today)
    await page.evaluate((targetDay) => {
      const dayButtons = Array.from(document.querySelectorAll('button')).filter(b => {
        const text = b.innerText.trim();
        const isNotNav = text !== '<' && text !== '>';
        const isNotDisabled = !b.className.includes('Disabled') && !b.disabled;
        return isNotNav && isNotDisabled && text === targetDay;
      });
      if (dayButtons.length > 0) {
        dayButtons[0].click();
      }
    }, targetDayStr);

    await new Promise(r => setTimeout(r, 1200));

    // 3. Select Time Slot (using native enabled slot button click)
    console.log(`[BOT] Selecting time slot...`);
    const enabledSlots = await page.$$('button._timeSlot_isxr4_221:not([disabled]):not([class*="Disabled"]), button[class*="timeSlot"]:not([disabled]):not([class*="Disabled"])');
    
    if (enabledSlots.length === 0) {
      throw new Error('No available time slots found on SMS Reminder for this date.');
    }

    // Try matching preferred slot or pick first available enabled slot
    let slotToClick = enabledSlots[0];
    for (const slotEl of enabledSlots) {
      const text = await page.evaluate(el => el.innerText.trim(), slotEl);
      if (text === targetTime12 || text.replace(/\s+/g, '') === targetTime12.replace(/\s+/g, '')) {
        slotToClick = slotEl;
        break;
      }
    }

    await slotToClick.click();
    console.log('[BOT] Clicked enabled time slot button.');
    await new Promise(r => setTimeout(r, 1200));

    // 4. Click "Continue to Details →"
    console.log('[BOT] Clicking Continue to Details...');
    const allButtons = await page.$$('button');
    for (const btn of allButtons) {
      const text = await page.evaluate(el => el.innerText, btn);
      if (text.includes('Continue to Details')) {
        await btn.click();
        break;
      }
    }

    // 5. Wait for Step 2 Details Form
    await page.waitForFunction(() => {
      return document.querySelector('input[placeholder*="name" i], input[type="text"], input[type="tel"]') !== null;
    }, { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    // 6. Fill Step 2 Details Form using React value setter
    console.log('[BOT] Filling Customer Details (Name, Phone, Email, Notes)...');
    const phoneDigits = (booking.phone || '').replace(/[^\d+]/g, '') || '4165550199';
    const noteText = booking.service_needed ? `Requirements: ${booking.service_needed}` : 'Brik Systems Consultation';

    await page.evaluate((custName, custPhone, custEmail, custNotes) => {
      const setReactValue = (element, value) => {
        const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(element, value);
        } else {
          element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
      };

      const inputs = Array.from(document.querySelectorAll('input'));
      for (const inp of inputs) {
        const ph = (inp.placeholder || '').toLowerCase();
        const id = (inp.id || '').toLowerCase();
        const tp = (inp.type || '').toLowerCase();
        const cl = (inp.className || '').toLowerCase();

        if (ph.includes('name') || tp === 'text') {
          setReactValue(inp, custName);
        } else if (ph.includes('phone') || cl.includes('phone') || tp === 'tel') {
          setReactValue(inp, custPhone);
        } else if (id.includes('email') || tp === 'email') {
          setReactValue(inp, custEmail);
        }
      }

      const textarea = document.querySelector('textarea');
      if (textarea) {
        setReactValue(textarea, custNotes);
      }
    }, booking.name, phoneDigits, booking.email, noteText);

    await new Promise(r => setTimeout(r, 1500));

    // 7. Click "Confirm Booking"
    console.log('[BOT] Submitting form on SMS Reminder...');
    await page.evaluate(() => {
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Confirm Booking'));
      if (confirmBtn) confirmBtn.click();
    });

    // Wait for confirmation
    await new Promise(r => setTimeout(r, 6000));

    console.log(`✅ [BOT] Successfully submitted booking on SMS Reminder for ${booking.name}!`);

    // 7. Update Supabase status to SYNCED
    await supabase
      .from('bookings')
      .update({
        status: 'SYNCED',
        notes: `Synced automatically to SMS Reminder & Google Calendar. Requirements: ${booking.service_needed}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', booking.id);

    // 8. Dispatch notification email to ipethankuds@gmail.com
    console.log(`[BOT] Sending notification email to ${ADMIN_EMAIL}...`);
    try {
      await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(ADMIN_EMAIL)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Origin': 'https://briksystem000.vercel.app',
          'Referer': 'https://briksystem000.vercel.app/'
        },
        body: JSON.stringify({
          _subject: `New Website Booking — ${booking.name}`,
          _template: 'table',
          _captcha: 'false',
          customer_name: booking.name,
          customer_email: booking.email,
          customer_phone: booking.phone,
          booking_date: booking.booking_date,
          booking_time: formatTimeTo12Hour(booking.booking_time),
          service_topic: booking.service_needed,
          sms_reminder_synced: 'YES — Connected to Google Calendar & SMS',
          booking_id: booking.id,
        })
      });
      console.log('✅ [BOT] Notification email dispatched.');
    } catch (mailErr) {
      console.warn('[BOT] Email notification notice:', mailErr.message);
    }

    await browser.close();
    return { success: true, bookingId: booking.id };
  } catch (err) {
    console.error(`❌ [BOT] Failed to sync booking #${booking.id}:`, err.message);
    await browser.close();

    await supabase
      .from('bookings')
      .update({
        status: 'FAILED',
        notes: `SMS Reminder Sync Error: ${err.message}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', booking.id);

    return { success: false, error: err.message };
  }
}

/**
 * Worker polling function to process all pending bookings in Supabase
 */
export async function processPendingBookings() {
  const { data: pending, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })
    .limit(5);

  if (error) {
    console.error('[BOT] Supabase query error:', error.message);
    return;
  }

  if (!pending || pending.length === 0) {
    return;
  }

  console.log(`[BOT] Found ${pending.length} pending booking(s) to sync.`);
  for (const item of pending) {
    await syncBookingToSmsReminder(item);
  }
}

// If run directly via `node smsReminderBot.js`
if (process.argv[1]?.endsWith('smsReminderBot.js')) {
  console.log('🚀 [BOT] SMS Reminder Automation Bot is running...');
  console.log(`Targeting URL: ${SMS_REMINDER_URL}`);
  
  // Run once immediately
  processPendingBookings().then(() => {
    console.log('Initial sync check complete. Running in background interval loop (every 20s)...');
    setInterval(processPendingBookings, 20000);
  });
}
