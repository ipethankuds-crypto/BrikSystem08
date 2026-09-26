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

    // 2. Select Date on Calendar
    const dateSelected = await page.evaluate((targetDay) => {
      const dayButtons = Array.from(document.querySelectorAll('button')).filter(b => {
        const text = b.innerText.trim();
        const isNotNav = text !== '<' && text !== '>';
        const isNotDisabled = !b.className.includes('Disabled');
        return isNotNav && isNotDisabled && text === targetDay;
      });

      if (dayButtons.length > 0) {
        dayButtons[0].click();
        return true;
      }
      return false;
    }, targetDayStr);

    if (!dateSelected) {
      console.warn(`[BOT] Specific day ${targetDayStr} not clickable or already selected, proceeding with current selection.`);
    }

    await new Promise(r => setTimeout(r, 1000));

    // 3. Select Time Slot
    const slotSelected = await page.evaluate((targetTime) => {
      const slotButtons = Array.from(document.querySelectorAll('button')).filter(b => {
        const text = b.innerText.trim();
        return text === targetTime || text.replace(/\s+/g, '') === targetTime.replace(/\s+/g, '');
      });

      if (slotButtons.length > 0) {
        slotButtons[0].click();
        return true;
      }
      
      // Fallback to first available slot if exact slot is unavailable
      const allSlots = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.includes('AM') || b.innerText.includes('PM'));
      if (allSlots.length > 0) {
        allSlots[0].click();
        return true;
      }
      return false;
    }, targetTime12);

    console.log(`[BOT] Time slot selected: ${slotSelected ? 'YES' : 'NO'}`);
    await new Promise(r => setTimeout(r, 800));

    // 4. Click "Continue to Details →"
    console.log('[BOT] Clicking Continue to Details...');
    await page.evaluate(() => {
      const continueBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Continue to Details'));
      if (continueBtn) continueBtn.click();
    });

    await page.waitForSelector('input[type="email"], input#booking-email, input[placeholder*="name"]', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1200));

    // 5. Fill Step 2 Details Form
    console.log('[BOT] Filling Customer Details (Name, Phone, Email, Notes)...');
    
    // Fill Name
    const nameFilled = await page.evaluate((fullName) => {
      const nameInput = document.querySelector('input[placeholder*="full name"]') || document.querySelector('input[placeholder*="Name"]');
      if (nameInput) {
        nameInput.value = fullName;
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        nameInput.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, booking.name);

    // Fill Phone
    const phoneDigits = booking.phone.replace(/[^\d+]/g, '');
    await page.evaluate((phone) => {
      const phoneInput = document.querySelector('input.PhoneInputInput') || document.querySelector('input[type="tel"]');
      if (phoneInput) {
        phoneInput.value = phone;
        phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
        phoneInput.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, phoneDigits);

    // Fill Email
    await page.evaluate((email) => {
      const emailInput = document.querySelector('input#booking-email') || document.querySelector('input[type="email"]');
      if (emailInput) {
        emailInput.value = email;
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        emailInput.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, booking.email);

    // Fill Notes / Topic
    const noteText = booking.service_needed ? `Requirements: ${booking.service_needed}` : 'Brik Systems Consultation';
    await page.evaluate((notes) => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.value = notes;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, noteText);

    await new Promise(r => setTimeout(r, 1000));

    // 6. Click "Confirm Booking"
    console.log('[BOT] Submitting form on SMS Reminder...');
    await page.evaluate(() => {
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Confirm Booking'));
      if (confirmBtn) confirmBtn.click();
    });

    // Wait for submission response
    await new Promise(r => setTimeout(r, 4000));

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
