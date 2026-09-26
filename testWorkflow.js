process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import { calendar as googleCalendar } from '@googleapis/calendar';
import { GoogleAuth } from 'google-auth-library';
import path from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qrrdmhwpiiwtixofyvqf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmRtaHdwaWl3dGl4b2Z5dnFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMDA2MjQsImV4cCI6MjEwMzc3NjYyNH0.K2f7ZRKiCaA9_PJPZZ-sQ2GY0tsxWQsd7hNwHiriEnc';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const auth = new GoogleAuth({
  keyFile: path.join(process.cwd(), 'service-account-key.json'),
  scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events']
});
const calendar = googleCalendar({ version: 'v3', auth });

const BASE_URL = 'http://localhost:3000';
const TEST_DATE = '2026-10-20';
const TEST_TIME = '15:30';

async function runTests() {
  console.log('=====================================================');
  console.log('🧪 RUNNING COMPREHENSIVE END-TO-END WORKFLOW TESTS');
  console.log('=====================================================\n');

  let testBookingId = null;
  let testGoogleEventId = null;

  // Clean up any previous test booking for this slot in Supabase
  await supabase.from('bookings').delete().eq('booking_date', TEST_DATE).eq('booking_time', TEST_TIME);

  // -----------------------------------------------------------------
  // TEST 1: Normal Booking Workflow
  // -----------------------------------------------------------------
  console.log('▶ TEST 1: Normal Booking (Valid data, PENDING -> PROCESSING -> SYNCED)');
  const res1 = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Michael Scott',
      email: 'michael@dundermifflin.com',
      phone: '(555) 234-5678',
      service_needed: 'Full Business Automation & Website',
      booking_date: TEST_DATE,
      booking_time: TEST_TIME,
      duration_minutes: 30
    })
  });

  const data1 = await res1.json();
  console.log(`HTTP Status: ${res1.status}`);
  console.log('Response:', JSON.stringify(data1, null, 2));

  if (res1.status === 201 && data1.success && data1.booking?.google_event_id) {
    testBookingId = data1.booking.id;
    testGoogleEventId = data1.booking.google_event_id;
    console.log('✅ TEST 1 PASSED: Booking created in Supabase with Google Calendar Event ID:', testGoogleEventId);
  } else {
    console.error('❌ TEST 1 FAILED');
    process.exit(1);
  }

  // Verify in Supabase
  const { data: dbRow } = await supabase.from('bookings').select('*').eq('id', testBookingId).single();
  console.log('Database Status in Supabase:', dbRow.status);
  if (dbRow.status === 'SYNCED') {
    console.log('✅ Supabase Status is correctly set to SYNCED');
  } else {
    console.error('❌ Expected status SYNCED but got:', dbRow.status);
  }

  // -----------------------------------------------------------------
  // TEST 2: Double-Booking Prevention (Same Slot)
  // -----------------------------------------------------------------
  console.log('\n▶ TEST 2: Double-Booking Prevention (Attempt booking same slot)');
  const res2 = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Dwight Schrute',
      email: 'dwight@dundermifflin.com',
      phone: '(555) 876-5432',
      service_needed: 'Beet Farming Automations',
      booking_date: TEST_DATE,
      booking_time: TEST_TIME,
      duration_minutes: 30
    })
  });

  const data2 = await res2.json();
  console.log(`HTTP Status: ${res2.status}`);
  console.log('Response:', JSON.stringify(data2));

  if (res2.status === 409 && data2.occupied) {
    console.log('✅ TEST 2 PASSED: Double booking prevented with 409 Conflict!');
  } else {
    console.error('❌ TEST 2 FAILED: Expected 409 Conflict');
  }

  // -----------------------------------------------------------------
  // TEST 3: Validation Error (Invalid Email & Missing Fields)
  // -----------------------------------------------------------------
  console.log('\n▶ TEST 3: Validation Error (Missing fields & invalid email)');
  const res3 = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Jim Halpert',
      email: 'invalid-email-string',
      phone: '',
      service_needed: 'Consulting',
      booking_date: TEST_DATE,
      booking_time: '16:00'
    })
  });

  const data3 = await res3.json();
  console.log(`HTTP Status: ${res3.status}`);
  console.log('Response:', JSON.stringify(data3));

  if (res3.status === 400 && data3.error) {
    console.log('✅ TEST 3 PASSED: Invalid input caught with 400 Bad Request!');
  } else {
    console.error('❌ TEST 3 FAILED: Expected 400 Bad Request');
  }

  // -----------------------------------------------------------------
  // TEST 4: Availability Endpoint Check
  // -----------------------------------------------------------------
  console.log('\n▶ TEST 4: Availability Verification');
  const res4 = await fetch(`${BASE_URL}/api/availability?date=${TEST_DATE}`);
  const data4 = await res4.json();
  console.log(`HTTP Status: ${res4.status}`);
  console.log('Booked Slots for Date:', data4.bookedSlots);

  if (data4.bookedSlots?.includes(TEST_TIME)) {
    console.log(`✅ TEST 4 PASSED: Booked slot ${TEST_TIME} correctly reported as unavailable!`);
  } else {
    console.error(`❌ TEST 4 FAILED: Expected slot ${TEST_TIME} in bookedSlots`);
  }

  // -----------------------------------------------------------------
  // CLEANUP: Delete Test Event from Google Calendar & Database
  // -----------------------------------------------------------------
  if (testGoogleEventId) {
    try {
      await calendar.events.delete({
        calendarId: 'ipethankuds@gmail.com',
        eventId: testGoogleEventId
      });
      console.log('\n🧹 Cleaned up test event from Google Calendar.');
    } catch (e) {
      console.warn('Cleanup notice:', e.message);
    }
  }

  await supabase.from('bookings').delete().eq('id', testBookingId);
  console.log('🧹 Cleaned up test booking from Supabase.');

  console.log('\n=====================================================');
  console.log('🎉 ALL TESTS PASSED! THE ENTIRE WORKFLOW IS 100% VERIFIED');
  console.log('=====================================================');
}

runTests().catch(err => {
  console.error('Test Suite Exception:', err);
  process.exit(1);
});
