// ==============================================================================
// BrikSystem12 - TypeScript Type Definitions
// ==============================================================================

export type UserRole = 'OWNER' | 'ADMIN' | 'STAFF' | 'TECHNICIAN';

export type LeadStatus = 'New' | 'Contacted' | 'Qualified' | 'Booked' | 'Won' | 'Lost';

export type JobStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type ReviewRequestStatus = 'PENDING' | 'SENT' | 'COMPLETED' | 'EXPIRED';

export type MessageChannel = 'SMS' | 'EMAIL' | 'SYSTEM';

export type MessageDirection = 'INBOUND' | 'OUTBOUND';

export interface BusinessHours {
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
}

export interface Business {
  id: string;
  name: string;
  slug: string;
  business_type: string; // 'plumber', 'electrician', 'hvac', 'roofer', 'landscaper', 'cleaner', etc.
  phone: string;
  email: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  logo_url: string;
  website_domain?: string;
  description: string;
  business_hours: BusinessHours;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  auth_user_id?: string;
  business_id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  avatar_url?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  business_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  organization_id: string;
  first_name?: string;
  last_name?: string;
  name: string;
  email?: string;
  phone?: string;
  service_requested?: string;
  source: string;
  status: LeadStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: string;
  business_id: string;
  name: string;
  description: string;
  price_description: string;
  estimated_duration_minutes: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  business_id: string;
  customer_id: string;
  lead_id?: string;
  service_id?: string;
  title: string;
  service: string;
  description: string;
  scheduled_date: string;
  scheduled_time: string;
  assigned_user_id?: string;
  status: JobStatus;
  price: number;
  notes: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  business_id: string;
  customer_id: string;
  lead_id?: string;
  job_id?: string;
  assigned_user_id?: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  service_type: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: string;
  business_id: string;
  customer_id?: string;
  job_id?: string;
  author_name: string;
  rating: number; // 1 to 5
  comment: string;
  request_status: ReviewRequestStatus;
  requested_at?: string;
  completed_at?: string;
  review_url?: string;
  public_display: boolean;
  created_at: string;
}

export interface AutomationRule {
  id: string;
  business_id: string;
  name: string;
  trigger_type: 'job_completed' | 'lead_created' | 'appointment_scheduled' | 'appointment_reminder';
  delay_minutes: number;
  channel: MessageChannel;
  message_template: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  business_id: string;
  customer_id?: string;
  lead_id?: string;
  job_id?: string;
  channel: MessageChannel;
  direction: MessageDirection;
  recipient: string;
  message: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';
  sent_at: string;
  created_at: string;
}

export interface ThemeSettings {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
}

export interface WebsiteSettings {
  id: string;
  business_id: string;
  headline: string;
  subheadline: string;
  about_text: string;
  logo_url: string;
  hero_image_url: string;
  primary_phone: string;
  primary_email: string;
  address: string;
  service_area_text: string;
  cta_text: string;
  theme_settings: ThemeSettings;
  created_at: string;
  updated_at: string;
}
