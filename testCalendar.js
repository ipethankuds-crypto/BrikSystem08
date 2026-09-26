import { calendar as googleCalendar } from '@googleapis/calendar';
import { GoogleAuth } from 'google-auth-library';
import path from 'path';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function test() {
  console.log('Testing Google Calendar Service Account connection...');
  const auth = new GoogleAuth({
    keyFile: path.join(process.cwd(), 'service-account-key.json'),
    scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events']
  });
  
  const calendar = googleCalendar({ version: 'v3', auth });
  
  const now = new Date();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  
  const fb = await calendar.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: tomorrow.toISOString(),
      items: [{ id: 'ipethankuds@gmail.com' }]
    }
  });
  
  console.log('✅ SUCCESS! Successfully connected to Google Calendar for ipethankuds@gmail.com');
  console.log('Busy query result:', fb.data.calendars['ipethankuds@gmail.com']);
}

test().catch(err => {
  console.error('❌ Connection Failed:', err);
});
