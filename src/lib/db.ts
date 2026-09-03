// ==============================================================================
// BrikSystem12 - Unified Multi-Tenant Database Layer & Automation Engine
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

import {
  INITIAL_BUSINESSES,
  INITIAL_PROFILES,
  INITIAL_CUSTOMERS,
  INITIAL_LEADS,
  INITIAL_JOBS,
  INITIAL_APPOINTMENTS,
  INITIAL_SERVICES,
  INITIAL_REVIEWS,
  INITIAL_AUTOMATION_RULES,
  INITIAL_MESSAGES,
  INITIAL_WEBSITE_SETTINGS,
} from './seedData';

const STORAGE_KEY = 'briksystem12_database_v1';

export interface DatabaseStore {
  businesses: Business[];
  profiles: UserProfile[];
  customers: Customer[];
  leads: Lead[];
  jobs: Job[];
  appointments: Appointment[];
  services: Service[];
  reviews: Review[];
  automation_rules: AutomationRule[];
  messages: Message[];
  website_settings: WebsiteSettings[];
  active_business_id: string;
  active_user_id: string;
}

class MultiTenantDB {
  private store: DatabaseStore;

  constructor() {
    this.store = this.loadStore();
  }

  private loadStore(): DatabaseStore {
    try {
      const serialized = localStorage.getItem(STORAGE_KEY);
      if (serialized) {
        return JSON.parse(serialized);
      }
    } catch (e) {
      console.warn('Could not read from localStorage, using initial seed data.', e);
    }

    const defaultStore: DatabaseStore = {
      businesses: INITIAL_BUSINESSES,
      profiles: INITIAL_PROFILES,
      customers: INITIAL_CUSTOMERS,
      leads: INITIAL_LEADS,
      jobs: INITIAL_JOBS,
      appointments: INITIAL_APPOINTMENTS,
      services: INITIAL_SERVICES,
      reviews: INITIAL_REVIEWS,
      automation_rules: INITIAL_AUTOMATION_RULES,
      messages: INITIAL_MESSAGES,
      website_settings: INITIAL_WEBSITE_SETTINGS,
      active_business_id: 'biz_01',
      active_user_id: 'usr_01',
    };

    this.saveStore(defaultStore);
    return defaultStore;
  }

  private saveStore(store: DatabaseStore): void {
    this.store = store;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      console.error('Failed to save store to localStorage', e);
    }
  }

  public resetToSeed(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.store = this.loadStore();
  }

  // ----------------------------------------------------------------------------
  // Tenant / Business Operations
  // ----------------------------------------------------------------------------
  public getBusinesses(): Business[] {
    return [...this.store.businesses];
  }

  public getBusiness(id: string): Business | undefined {
    return this.store.businesses.find((b) => b.id === id);
  }

  public getBusinessBySlug(slug: string): Business | undefined {
    return this.store.businesses.find((b) => b.slug.toLowerCase() === slug.toLowerCase());
  }

  public getActiveBusiness(): Business {
    const biz = this.getBusiness(this.store.active_business_id);
    return biz || this.store.businesses[0];
  }

  public setActiveBusiness(businessId: string): void {
    this.store.active_business_id = businessId;
    const userForBiz = this.store.profiles.find((p) => p.business_id === businessId);
    if (userForBiz) {
      this.store.active_user_id = userForBiz.id;
    }
    this.saveStore(this.store);
  }

  public createBusiness(
    data: Omit<Business, 'id' | 'created_at' | 'updated_at'>,
    ownerName: string,
    ownerEmail: string
  ): { business: Business; owner: UserProfile } {
    const businessId = `biz_${Date.now()}`;
    const newBusiness: Business = {
      ...data,
      id: businessId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const ownerId = `usr_${Date.now()}`;
    const ownerProfile: UserProfile = {
      id: ownerId,
      business_id: businessId,
      name: ownerName,
      email: ownerEmail,
      phone: data.phone,
      role: 'OWNER',
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const newWebsiteSettings: WebsiteSettings = {
      id: `ws_${Date.now()}`,
      business_id: businessId,
      headline: `Top Rated ${data.business_type} Services in ${data.city || 'Your Area'}`,
      subheadline: data.description,
      about_text: `${data.name} is dedicated to honest pricing, prompt arrivals, and licensed craftsmanship.`,
      logo_url: data.logo_url || 'https://images.unsplash.com/photo-1581244277943-fe4a9c777189?w=128&auto=format&fit=crop&q=80',
      hero_image_url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1200&auto=format&fit=crop&q=80',
      primary_phone: data.phone,
      primary_email: data.email,
      address: `${data.address}, ${data.city}, ${data.province}`,
      service_area_text: `Serving ${data.city} and surrounding communities`,
      cta_text: 'Get an Instant Quote & Book Online',
      theme_settings: {
        primaryColor: '#0284c7',
        secondaryColor: '#0f172a',
        accentColor: '#f59e0b',
        fontFamily: 'Inter, sans-serif',
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.store.businesses.push(newBusiness);
    this.store.profiles.push(ownerProfile);
    this.store.website_settings.push(newWebsiteSettings);
    this.store.active_business_id = businessId;
    this.store.active_user_id = ownerId;
    this.saveStore(this.store);

    return { business: newBusiness, owner: ownerProfile };
  }

  // ----------------------------------------------------------------------------
  // Active User / Auth Operations
  // ----------------------------------------------------------------------------
  public getActiveUser(): UserProfile {
    const user = this.store.profiles.find((p) => p.id === this.store.active_user_id);
    return (
      user || {
        id: 'usr_default',
        business_id: this.store.active_business_id,
        name: 'Business User',
        email: 'user@example.com',
        phone: '(555) 000-0000',
        role: 'OWNER',
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    );
  }

  public setActiveUser(userId: string): void {
    this.store.active_user_id = userId;
    const user = this.store.profiles.find((p) => p.id === userId);
    if (user && user.business_id !== this.store.active_business_id) {
      this.store.active_business_id = user.business_id;
    }
    this.saveStore(this.store);
  }

  public getProfiles(businessId: string): UserProfile[] {
    return this.store.profiles.filter((p) => p.business_id === businessId);
  }

  public addProfile(profile: Omit<UserProfile, 'id' | 'created_at' | 'updated_at'>): UserProfile {
    const newProfile: UserProfile = {
      ...profile,
      id: `usr_${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.profiles.push(newProfile);
    this.saveStore(this.store);
    return newProfile;
  }

  // ----------------------------------------------------------------------------
  // Customers
  // ----------------------------------------------------------------------------
  public getCustomers(businessId: string): Customer[] {
    return this.store.customers.filter((c) => c.business_id === businessId);
  }

  public getCustomer(id: string): Customer | undefined {
    return this.store.customers.find((c) => c.id === id);
  }

  public addCustomer(data: Omit<Customer, 'id' | 'created_at' | 'updated_at'>): Customer {
    const newCustomer: Customer = {
      ...data,
      id: `cust_${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.customers.unshift(newCustomer);
    this.saveStore(this.store);
    return newCustomer;
  }

  public updateCustomer(id: string, data: Partial<Customer>): Customer | null {
    const index = this.store.customers.findIndex((c) => c.id === id);
    if (index === -1) return null;
    this.store.customers[index] = {
      ...this.store.customers[index],
      ...data,
      updated_at: new Date().toISOString(),
    };
    this.saveStore(this.store);
    return this.store.customers[index];
  }

  public deleteCustomer(id: string): boolean {
    this.store.customers = this.store.customers.filter((c) => c.id !== id);
    this.saveStore(this.store);
    return true;
  }

  // ----------------------------------------------------------------------------
  // Leads & Public Quote Submissions
  // ----------------------------------------------------------------------------
  public getLeads(businessId: string): Lead[] {
    return this.store.leads.filter((l) => l.business_id === businessId);
  }

  public addLead(data: Omit<Lead, 'id' | 'created_at' | 'updated_at'>): Lead {
    const newLead: Lead = {
      ...data,
      id: `lead_${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.leads.unshift(newLead);
    this.saveStore(this.store);

    // Trigger lead_created automation
    this.triggerAutomation(data.business_id, 'lead_created', {
      customer_name: newLead.name,
      service_name: newLead.service_requested,
      customer_phone: newLead.phone,
      customer_email: newLead.email,
    });

    return newLead;
  }

  public updateLead(id: string, data: Partial<Lead>): Lead | null {
    const index = this.store.leads.findIndex((l) => l.id === id);
    if (index === -1) return null;
    this.store.leads[index] = {
      ...this.store.leads[index],
      ...data,
      updated_at: new Date().toISOString(),
    };
    this.saveStore(this.store);
    return this.store.leads[index];
  }

  public convertLeadToCustomer(leadId: string): { customer: Customer; lead: Lead } | null {
    const lead = this.store.leads.find((l) => l.id === leadId);
    if (!lead) return null;

    // Check if customer already exists or create new one
    const nameParts = lead.name.trim().split(' ');
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || 'Customer';

    const customer = this.addCustomer({
      business_id: lead.business_id,
      first_name: firstName,
      last_name: lastName,
      email: lead.email || '',
      phone: lead.phone,
      address: '',
      city: '',
      province: '',
      postal_code: '',
      notes: `Converted from lead (${lead.service_requested}). ${lead.notes || ''}`,
    });

    lead.status = 'CONVERTED';
    lead.customer_id = customer.id;
    lead.updated_at = new Date().toISOString();
    this.saveStore(this.store);

    return { customer, lead };
  }

  // ----------------------------------------------------------------------------
  // Jobs
  // ----------------------------------------------------------------------------
  public getJobs(businessId: string): Job[] {
    return this.store.jobs.filter((j) => j.business_id === businessId);
  }

  public addJob(data: Omit<Job, 'id' | 'created_at' | 'updated_at'>): Job {
    const newJob: Job = {
      ...data,
      id: `job_${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.jobs.unshift(newJob);
    this.saveStore(this.store);
    return newJob;
  }

  public updateJob(id: string, data: Partial<Job>): Job | null {
    const index = this.store.jobs.findIndex((j) => j.id === id);
    if (index === -1) return null;

    const currentJob = this.store.jobs[index];
    const isNowCompleted = data.status === 'COMPLETED' && currentJob.status !== 'COMPLETED';

    const updatedJob: Job = {
      ...currentJob,
      ...data,
      completed_at: isNowCompleted ? new Date().toISOString() : (data.completed_at || currentJob.completed_at),
      updated_at: new Date().toISOString(),
    };

    this.store.jobs[index] = updatedJob;
    this.saveStore(this.store);

    if (isNowCompleted) {
      const customer = this.getCustomer(updatedJob.customer_id);
      this.triggerAutomation(updatedJob.business_id, 'job_completed', {
        customer_name: customer ? `${customer.first_name} ${customer.last_name}` : 'Valued Customer',
        customer_phone: customer?.phone || '',
        customer_email: customer?.email || '',
        job_title: updatedJob.title,
        job_id: updatedJob.id,
        customer_id: updatedJob.customer_id,
        review_link: `/#/site/${this.getBusiness(updatedJob.business_id)?.slug}?review=true`,
      });
    }

    return updatedJob;
  }

  // ----------------------------------------------------------------------------
  // Appointments
  // ----------------------------------------------------------------------------
  public getAppointments(businessId: string): Appointment[] {
    return this.store.appointments.filter((a) => a.business_id === businessId);
  }

  public addAppointment(data: Omit<Appointment, 'id' | 'created_at' | 'updated_at'>): Appointment {
    const newApt: Appointment = {
      ...data,
      id: `apt_${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.appointments.unshift(newApt);
    this.saveStore(this.store);
    return newApt;
  }

  public updateAppointment(id: string, data: Partial<Appointment>): Appointment | null {
    const index = this.store.appointments.findIndex((a) => a.id === id);
    if (index === -1) return null;
    this.store.appointments[index] = {
      ...this.store.appointments[index],
      ...data,
      updated_at: new Date().toISOString(),
    };
    this.saveStore(this.store);
    return this.store.appointments[index];
  }

  // ----------------------------------------------------------------------------
  // Services
  // ----------------------------------------------------------------------------
  public getServices(businessId: string): Service[] {
    return this.store.services.filter((s) => s.business_id === businessId);
  }

  public addService(data: Omit<Service, 'id' | 'created_at' | 'updated_at'>): Service {
    const newService: Service = {
      ...data,
      id: `srv_${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.services.push(newService);
    this.saveStore(this.store);
    return newService;
  }

  public updateService(id: string, data: Partial<Service>): Service | null {
    const index = this.store.services.findIndex((s) => s.id === id);
    if (index === -1) return null;
    this.store.services[index] = {
      ...this.store.services[index],
      ...data,
      updated_at: new Date().toISOString(),
    };
    this.saveStore(this.store);
    return this.store.services[index];
  }

  // ----------------------------------------------------------------------------
  // Reviews
  // ----------------------------------------------------------------------------
  public getReviews(businessId: string): Review[] {
    return this.store.reviews.filter((r) => r.business_id === businessId);
  }

  public addReview(data: Omit<Review, 'id' | 'created_at'>): Review {
    const newReview: Review = {
      ...data,
      id: `rev_${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    this.store.reviews.unshift(newReview);
    this.saveStore(this.store);
    return newReview;
  }

  // ----------------------------------------------------------------------------
  // Automation Rules & Message Dispatch
  // ----------------------------------------------------------------------------
  public getAutomationRules(businessId: string): AutomationRule[] {
    return this.store.automation_rules.filter((r) => r.business_id === businessId);
  }

  public toggleAutomationRule(id: string, active: boolean): void {
    const rule = this.store.automation_rules.find((r) => r.id === id);
    if (rule) {
      rule.active = active;
      rule.updated_at = new Date().toISOString();
      this.saveStore(this.store);
    }
  }

  public updateAutomationRule(id: string, data: Partial<AutomationRule>): AutomationRule | null {
    const index = this.store.automation_rules.findIndex((r) => r.id === id);
    if (index === -1) return null;
    this.store.automation_rules[index] = {
      ...this.store.automation_rules[index],
      ...data,
      updated_at: new Date().toISOString(),
    };
    this.saveStore(this.store);
    return this.store.automation_rules[index];
  }

  public getMessages(businessId: string): Message[] {
    return this.store.messages.filter((m) => m.business_id === businessId);
  }

  public triggerAutomation(
    businessId: string,
    triggerType: 'job_completed' | 'lead_created' | 'appointment_scheduled' | 'appointment_reminder',
    context: Record<string, any>
  ): void {
    const activeRules = this.store.automation_rules.filter(
      (r) => r.business_id === businessId && r.trigger_type === triggerType && r.active
    );

    const business = this.getBusiness(businessId);
    const businessName = business?.name || 'Our Service Team';

    activeRules.forEach((rule) => {
      let populatedMessage = rule.message_template
        .replace(/{{customer_name}}/g, context.customer_name || 'there')
        .replace(/{{business_name}}/g, businessName)
        .replace(/{{service_name}}/g, context.service_name || 'your requested service')
        .replace(/{{review_link}}/g, context.review_link || 'https://review.us/5stars')
        .replace(/{{appointment_time}}/g, context.appointment_time || 'tomorrow');

      const newMessage: Message = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        business_id: businessId,
        customer_id: context.customer_id,
        lead_id: context.lead_id,
        job_id: context.job_id,
        channel: rule.channel,
        direction: 'OUTBOUND',
        recipient: context.customer_phone || context.customer_email || 'Customer',
        message: populatedMessage,
        status: 'SENT',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      this.store.messages.unshift(newMessage);
    });

    this.saveStore(this.store);
  }

  // ----------------------------------------------------------------------------
  // Website Settings
  // ----------------------------------------------------------------------------
  public getWebsiteSettings(businessId: string): WebsiteSettings {
    const ws = this.store.website_settings.find((w) => w.business_id === businessId);
    if (ws) return ws;

    const biz = this.getBusiness(businessId);
    const fallback: WebsiteSettings = {
      id: `ws_${Date.now()}`,
      business_id: businessId,
      headline: `Top Rated ${biz?.business_type || 'Local'} Services`,
      subheadline: biz?.description || 'Fast, reliable and guaranteed service.',
      about_text: `Proudly serving our local community with master-level quality and honest service.`,
      logo_url: biz?.logo_url || '',
      hero_image_url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1200&auto=format&fit=crop&q=80',
      primary_phone: biz?.phone || '(555) 000-0000',
      primary_email: biz?.email || 'service@example.com',
      address: `${biz?.address || ''}, ${biz?.city || ''}`,
      service_area_text: `Serving ${biz?.city || 'the area'} within 30 miles`,
      cta_text: 'Get an Instant Estimate & Book Online',
      theme_settings: {
        primaryColor: '#0284c7',
        secondaryColor: '#0f172a',
        accentColor: '#f59e0b',
        fontFamily: 'Inter, sans-serif',
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.store.website_settings.push(fallback);
    this.saveStore(this.store);
    return fallback;
  }

  public updateWebsiteSettings(businessId: string, data: Partial<WebsiteSettings>): WebsiteSettings {
    const index = this.store.website_settings.findIndex((w) => w.business_id === businessId);
    if (index === -1) {
      const newWs: WebsiteSettings = {
        ...this.getWebsiteSettings(businessId),
        ...data,
        updated_at: new Date().toISOString(),
      };
      this.store.website_settings.push(newWs);
      this.saveStore(this.store);
      return newWs;
    }

    this.store.website_settings[index] = {
      ...this.store.website_settings[index],
      ...data,
      updated_at: new Date().toISOString(),
    };
    this.saveStore(this.store);
    return this.store.website_settings[index];
  }
}

export const db = new MultiTenantDB();
