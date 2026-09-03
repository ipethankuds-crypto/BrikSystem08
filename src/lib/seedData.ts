// ==============================================================================
// BrikSystem12 - Multi-Tenant Seed Data (Zero Mock CRM Data)
// ==============================================================================

import {
  Business,
  UserProfile,
  Customer,
  Lead,
  Job,
  Appointment,
  Service,
  Review,
  AutomationRule,
  Message,
  WebsiteSettings,
} from '../types';

export const INITIAL_BUSINESSES: Business[] = [
  {
    id: 'biz_01',
    name: 'Northside Plumbing & Heating',
    slug: 'northside-plumbing',
    business_type: 'Plumbing & Heating',
    phone: '(416) 555-0100',
    email: 'service@northsideplumbing.ca',
    address: '142 King St West',
    city: 'Toronto',
    province: 'ON',
    postal_code: 'M5H 1J8',
    logo_url: 'https://images.unsplash.com/photo-1581244277943-fe4a9c777189?w=128&auto=format&fit=crop&q=80',
    website_domain: 'northsideplumbing.ca',
    description: 'Premier residential and commercial plumbing, drain cleaning, and heating solutions.',
    business_hours: {
      monday: '7:30 AM - 6:00 PM',
      tuesday: '7:30 AM - 6:00 PM',
      wednesday: '7:30 AM - 6:00 PM',
      thursday: '7:30 AM - 6:00 PM',
      friday: '7:30 AM - 6:00 PM',
      saturday: '8:00 AM - 4:00 PM',
      sunday: '24/7 Emergency Dispatch',
    },
    timezone: 'America/Toronto',
    created_at: '2026-01-15T09:00:00Z',
    updated_at: '2026-08-30T10:00:00Z',
  },
];

export const INITIAL_PROFILES: UserProfile[] = [];

export const INITIAL_SERVICES: Service[] = [];

export const INITIAL_CUSTOMERS: Customer[] = [];

export const INITIAL_LEADS: Lead[] = [];

export const INITIAL_JOBS: Job[] = [];

export const INITIAL_APPOINTMENTS: Appointment[] = [];

export const INITIAL_REVIEWS: Review[] = [];

export const INITIAL_AUTOMATION_RULES: AutomationRule[] = [
  {
    id: 'auto_01',
    business_id: 'biz_01',
    name: 'Instant New Lead SMS & Email Confirmation',
    trigger_type: 'lead_created',
    delay_minutes: 0,
    channel: 'SMS',
    message_template: 'Hi {{customer_name}}, thank you for reaching out to {{business_name}}! We received your request and our team will contact you shortly.',
    active: true,
    created_at: '2026-01-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
  },
  {
    id: 'auto_02',
    business_id: 'biz_01',
    name: 'Post-Job 5-Star Review Request',
    trigger_type: 'job_completed',
    delay_minutes: 30,
    channel: 'SMS',
    message_template: 'Hi {{customer_name}}, your service with {{business_name}} was marked completed! How did our technician do today? Please share your feedback: {{review_link}}',
    active: true,
    created_at: '2026-01-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
  },
  {
    id: 'auto_03',
    business_id: 'biz_01',
    name: '24-Hour Appointment Reminder',
    trigger_type: 'appointment_reminder',
    delay_minutes: 1440,
    channel: 'SMS',
    message_template: 'Reminder: Your appointment with {{business_name}} is scheduled for {{appointment_time}}. Please reply YES to confirm or CALL to reschedule.',
    active: true,
    created_at: '2026-01-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
  },
];

export const INITIAL_MESSAGES: Message[] = [];

export const INITIAL_WEBSITE_SETTINGS: WebsiteSettings[] = [];
