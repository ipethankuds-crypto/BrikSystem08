import { createClient } from '@supabase/supabase-js';

// Support Vite import.meta.env or permanent defaults
const SUPABASE_URL: string =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUPABASE_URL) ||
  (typeof window !== 'undefined' && (window as any).__SUPABASE_URL__) ||
  'https://qrrdmhwpiiwtixofyvqf.supabase.co';

const SUPABASE_ANON_KEY: string =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof window !== 'undefined' && (window as any).__SUPABASE_ANON_KEY__) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmRtaHdwaWl3dGl4b2Z5dnFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMDA2MjQsImV4cCI6MjEwMzc3NjYyNH0.K2f7ZRKiCaA9_PJPZZ-sQ2GY0tsxWQsd7hNwHiriEnc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export interface Organization {
  id: string;
  name: string;
  slug: string;
  business_type: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  organization_id: string;
  role: 'ADMIN' | 'CLIENT';
  full_name: string;
  email: string;
  phone?: string;
  avatar_url?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  organization?: Organization;
}

export type LeadStatus = 'New' | 'Contacted' | 'Qualified' | 'Booked' | 'Won' | 'Lost';

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
