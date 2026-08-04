import { pgTable, text, integer, doublePrecision, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

// Mirrors src/domain/types.js entities exactly (see that file for the
// authoritative field-by-field doc comments — not duplicated here).
// One deliberate simplification for this first pass: no foreign-key
// constraints between tables. The client has never enforced referential
// integrity either (IndexedDB has no FK concept), ownership is an
// app-layer convention throughout this codebase (see
// docs/ARCHITECTURE.md's "Entity ownership" section), and adding FKs
// later is additive, not a breaking change to the generic repository
// contract below. All `id` columns are `text`, not DB-generated —
// every client service already generates its own id via
// `src/domain/ids.js`'s `newId(prefix)` before calling `insert()`, so
// the server just persists whatever id it's given, same as
// `IndexedDbRepository.insert()` does today.
//
// Dates/timestamps are stored as plain `text` (ISO strings or
// "YYYY-MM-DD"), not native Postgres date/timestamp types — this keeps
// `drizzleRepository` fully generic (no per-column type coercion) and
// exactly matches what the client already stores (plain JS Date
// `.toISOString()` strings), avoiding any serialisation mismatch at
// the client/server boundary.

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  ownerPersonId: text("owner_person_id"),
  createdAt: text("created_at").notNull(),
});

export const people = pgTable("people", {
  id: text("id").primaryKey(),
  name: text("name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  displayName: text("display_name"),
  email: text("email"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
});

export const memberships = pgTable("memberships", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  personId: text("person_id").notNull(),
  roles: text("roles").array().notNull(),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
});

export const organisations = pgTable("organisations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  legalName: text("legal_name").notNull(),
  tradingName: text("trading_name").notNull(),
  types: text("types").array().notNull(),
  archivedAt: text("archived_at"),
  createdAt: text("created_at"),
});

export const sites = pgTable("sites", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  clientName: text("client_name"),
  address: text("address"),
  notes: text("notes"),
  archivedAt: text("archived_at"),
});

export const driverProfiles = pgTable("driver_profiles", {
  id: text("id").primaryKey(),
  personId: text("person_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  referenceNumber: text("reference_number"),
  defaultBreakMinutes: integer("default_break_minutes"),
  lastUsedAssignmentId: text("last_used_assignment_id"),
  preferredAssignmentId: text("preferred_assignment_id"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
});

export const engagements = pgTable("engagements", {
  id: text("id").primaryKey(),
  providerOrganisationId: text("provider_organisation_id").notNull(),
  employerOrganisationId: text("employer_organisation_id"),
  workspaceId: text("workspace_id").notNull(),
  driverId: text("driver_id").notNull(),
  relationshipType: text("relationship_type").notNull(),
  role: text("role"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  status: text("status").notNull(),
});

export const placements = pgTable("placements", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  providerOrganisationId: text("provider_organisation_id").notNull(),
  siteId: text("site_id").notNull(),
  rateCardLineageId: text("rate_card_lineage_id").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
});

export const assignments = pgTable("assignments", {
  id: text("id").primaryKey(),
  engagementId: text("engagement_id").notNull(),
  placementId: text("placement_id").notNull(),
  siteId: text("site_id"),
  rateCardLineageId: text("rate_card_lineage_id"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
});

export const shifts = pgTable("shifts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  driverId: text("driver_id").notNull(),
  assignmentId: text("assignment_id"),
  date: text("date").notNull(),
  start: text("start").notNull(),
  end: text("end").notNull(),
  breakMinutes: integer("break_minutes").notNull(),
  drivingHours: doublePrecision("driving_hours").notNull(),
  rateCardId: text("rate_card_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  source: text("source").notNull(),
});

export const rateCardLineages = pgTable("rate_card_lineages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  payType: text("pay_type"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
});

export const rateCards = pgTable("rate_cards", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  lineageId: text("lineage_id").notNull(),
  version: integer("version").notNull(),
  supersedesId: text("supersedes_id"),
  effectiveFrom: text("effective_from").notNull(),
  rates: jsonb("rates").notNull(),
});

export const loads = pgTable("loads", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  shiftId: text("shift_id").notNull(),
  reference: text("reference"),
  description: text("description"),
  amount: doublePrecision("amount").notNull(),
  distanceMiles: doublePrecision("distance_miles"),
  createdAt: text("created_at").notNull(),
});

export const complianceProfiles = pgTable("compliance_profiles", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  rules: jsonb("rules").notNull(),
});

export const vehicles = pgTable("vehicles", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  registration: text("registration").notNull(),
  vehicleType: text("vehicle_type").notNull(),
  make: text("make"),
  model: text("model"),
  notes: text("notes"),
  motExpiryDate: text("mot_expiry_date"),
  insuranceExpiryDate: text("insurance_expiry_date"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
});

export const checklistTemplates = pgTable("checklist_templates", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  items: jsonb("items").notNull(),
  isDefault: boolean("is_default").notNull(),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
});

export const vehicleChecks = pgTable("vehicle_checks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  driverId: text("driver_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  pairedVehicleId: text("paired_vehicle_id"),
  shiftId: text("shift_id"),
  checklistTemplateId: text("checklist_template_id").notNull(),
  items: jsonb("items").notNull(),
  overallResult: text("overall_result").notNull(),
  odometerReading: integer("odometer_reading"),
  performedAt: text("performed_at").notNull(),
  driverSignOffName: text("driver_sign_off_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const defects = pgTable("defects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  raisedFromCheckId: text("raised_from_check_id"),
  raisedFromItemCode: text("raised_from_item_code"),
  raisedByDriverId: text("raised_by_driver_id").notNull(),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull(),
  resolvedAt: text("resolved_at"),
  resolvedNotes: text("resolved_notes"),
  createdAt: text("created_at").notNull(),
});

export const driverDocuments = pgTable("driver_documents", {
  id: text("id").primaryKey(),
  personId: text("person_id").notNull(),
  documentType: text("document_type").notNull(),
  label: text("label"),
  referenceNumber: text("reference_number"),
  expiryDate: text("expiry_date"),
  notes: text("notes"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const cpcTrainingRecords = pgTable("cpc_training_records", {
  id: text("id").primaryKey(),
  personId: text("person_id").notNull(),
  date: text("date").notNull(),
  hours: doublePrecision("hours").notNull(),
  provider: text("provider"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

// New for the backend/auth phase (see
// decision-2026-08-04-working-time-backend-auth-architecture) — not
// part of the client's domain model, server-only.

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  personId: text("person_id").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
